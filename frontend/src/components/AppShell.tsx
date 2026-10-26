// Authenticated app shell: persistent left Sidebar + the active screen.
// On entry it loads the current user's readable modules (feat-010) to gate both
// the sidebar (handled in Sidebar) and the content (a forbidden module → 403).
import { EmptyState } from "./EmptyState";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  ApiError,
  connectQuoteEvents,
  type CanDoiKhoaDong,
  type DepartmentPurchaseSourceType,
  type HangLoai,
  type PinnedCustomer,
  type QuoteEvent,
  type SxTeam,
} from "../api/client";
import { crud } from "../api/rebuildCatalog";
import { useAuth } from "../auth/useAuth";
import {
  buildCapabilities,
  PermissionsProvider,
  type Capabilities,
} from "../auth/permissions";
import { nhanChang, nhanDonVi } from "../pages/lsxBuoc";
import { toastKhoNhapThanhPham } from "../pages/kcs/kcsNhan";
import { num } from "../pages/keHoachSxShared";
import { kenhCuaNav, loiNhacCua, navCuaKenh } from "../lib/thongBaoMan";
import { toLaDauTien } from "../lib/banToLa";
import type { KhoNhapSeed } from "../pages/KhoDeNghiPage";
// Danh mục rebuild (config .tsx — render pill JSX). Nạp TĨNH: bảng này quyết định định tuyến
// (`REBUILD_CONFIGS[baseId]`) nên phải có ngay, không chờ được.
import { REBUILD_CONFIGS } from "../pages/rebuildCatalogConfigs";
import { boManDangMo, datManDangMo, manTrenUrl } from "../pages/ke-toan/shared/urlMan";
import {
  MOI_NHOM,
  nhomCua,
  taoBoGopNhip,
  taoHoanNap,
  tickRong,
  tongTick,
  type NhomSuKien,
  type TickNhom,
} from "../lib/suKienNhom";

// ---- Các màn: TÁCH BUNDLE (sức chịu tải, mục B "Khác") -------------------------------------------
// Trước 28/09/2026 cả app là MỘT tệp JS ~4,6 MB: công nhân mở bàn tổ trên 4G vẫn phải tải thư viện
// bản đồ, biểu đồ, và mọi màn kế toán. Nay mỗi màn là một chunk riêng, chỉ tải khi mở lần đầu.
// Giữ named export của từng màn: `lazy` đòi `default` nên bọc `.then(m => ({ default: m.Ten }))`.
const ActivityLogPage = lazy(() => import("../pages/ActivityLogPage").then((m) => ({ default: m.ActivityLogPage })));
const BaoGiaPage = lazy(() => import("../pages/BaoGiaPage").then((m) => ({ default: m.BaoGiaPage })));
const DonHangBanPage = lazy(() => import("../pages/DonHangBanPage").then((m) => ({ default: m.DonHangBanPage })));
const BaoCaoKinhDoanhPage = lazy(() =>
  import("../pages/bao-cao-kinh-doanh/BaoCaoKinhDoanhPage").then((m) => ({ default: m.BaoCaoKinhDoanhPage })));
const GiaoHangPage = lazy(() => import("../pages/giao-hang/giao-hang"));
const KeHoachSXPage = lazy(() => import("../pages/KeHoachSXPage").then((m) => ({ default: m.KeHoachSXPage })));
const LenhSanXuatPage = lazy(() => import("../pages/LenhSanXuatPage").then((m) => ({ default: m.LenhSanXuatPage })));
const TheoDoiSanXuatPage = lazy(() =>
  import("../pages/TheoDoiSanXuatPage").then((m) => ({ default: m.TheoDoiSanXuatPage })));
const KeHoachVatTuPage = lazy(() => import("../pages/KeHoachVatTuPage").then((m) => ({ default: m.KeHoachVatTuPage })));
const BaiGhep2Page = lazy(() => import("../pages/BaiGhep2Page").then((m) => ({ default: m.BaiGhep2Page })));
const XepLichPage = lazy(() => import("../pages/XepLichPage").then((m) => ({ default: m.XepLichPage })));
const ThucHienSxPage = lazy(() => import("../pages/ThucHienSxPage").then((m) => ({ default: m.ThucHienSxPage })));
const KcsTheoLenhPage = lazy(() => import("../pages/kcs/KcsTheoLenhPage").then((m) => ({ default: m.KcsTheoLenhPage })));
const SuaChuaMayPage = lazy(() => import("../pages/SuaChuaMayPage").then((m) => ({ default: m.SuaChuaMayPage })));
const PhieuBaoTriPage = lazy(() => import("../pages/PhieuBaoTriPage").then((m) => ({ default: m.PhieuBaoTriPage })));
const TinhGiaPage = lazy(() => import("../pages/TinhGiaPage").then((m) => ({ default: m.TinhGiaPage })));
const DashboardPage = lazy(() => import("../pages/DashboardPage").then((m) => ({ default: m.DashboardPage })));
const DepartmentsPage = lazy(() =>
  import("../pages/nhan-su-luong/phong-ban").then((m) => ({ default: m.DepartmentsPage })));
const KhachHangPage = lazy(() => import("../pages/KhachHangPage").then((m) => ({ default: m.KhachHangPage })));
const QuyTrinhKinhDoanhPage = lazy(() =>
  import("../pages/QuyTrinhKinhDoanhPage").then((m) => ({ default: m.QuyTrinhKinhDoanhPage })));
const ChamCongPage = lazy(() => import("../pages/nhan-su-luong/cham-cong").then((m) => ({ default: m.ChamCongPage })));
const NghiPhepPage = lazy(() => import("../pages/nhan-su-luong/nghi-phep").then((m) => ({ default: m.NghiPhepPage })));
const TangCaPage = lazy(() => import("../pages/nhan-su-luong/tang-ca").then((m) => ({ default: m.TangCaPage })));
const LuongPage = lazy(() => import("../pages/nhan-su-luong/luong").then((m) => ({ default: m.LuongPage })));
const HoSoCuaToiPage = lazy(() =>
  import("../pages/nhan-su-luong/ho-so-cua-toi").then((m) => ({ default: m.HoSoCuaToiPage })));
const NoiQuyPage = lazy(() => import("../pages/nhan-su-luong/noi-quy").then((m) => ({ default: m.NoiQuyPage })));
const NhanSuPage = lazy(() => import("../pages/nhan-su-luong/nhan-su").then((m) => ({ default: m.NhanSuPage })));
const KcsTieuChiPage = lazy(() => import("../pages/danh-muc/kcs-tieu-chi/KcsTieuChiPage").then((m) => ({ default: m.KcsTieuChiPage })));
const RebuildCatalogPage = lazy(() =>
  import("../pages/RebuildCatalogPage").then((m) => ({ default: m.RebuildCatalogPage })));
const KhoTonKhoPage = lazy(() => import("../pages/KhoTonKhoPage").then((m) => ({ default: m.KhoTonKhoPage })));
const KhoPage = lazy(() => import("../pages/KhoPage").then((m) => ({ default: m.KhoPage })));
const KhoBaoCaoPage = lazy(() => import("../pages/KhoBaoCaoPage").then((m) => ({ default: m.KhoBaoCaoPage })));
const DepartmentPurchaseRequestsPage = lazy(() =>
  import("../pages/mua-hang/yeu-cau-mua-hang").then((m) => ({ default: m.DepartmentPurchaseRequestsPage })));
const PurchaseRequestsPage = lazy(() =>
  import("../pages/mua-hang/phieu-mua-hang").then((m) => ({ default: m.PurchaseRequestsPage })));
const SuppliersPage = lazy(() => import("../pages/mua-hang/nha-cung-cap").then((m) => ({ default: m.SuppliersPage })));
const AccountingPayablesPage = lazy(() =>
  import("../pages/ke-toan/cong-no-phai-tra").then((m) => ({ default: m.AccountingPayablesPage })));
const AccountingReceivablesPage = lazy(() =>
  import("../pages/ke-toan/cong-no-phai-thu").then((m) => ({ default: m.AccountingReceivablesPage })));
const BaoCaoKeToanPage = lazy(() => import("../pages/ke-toan/bao-cao").then((m) => ({ default: m.BaoCaoKeToanPage })));
const BaoCaoThuChiPage = lazy(() => import("../pages/bao-cao-thu-chi").then((m) => ({ default: m.BaoCaoThuChiPage })));
const AccountingPurchaseInboxPage = lazy(() =>
  import("../pages/ke-toan/don-mua-hang").then((m) => ({ default: m.AccountingPurchaseInboxPage })));
const PaymentVouchersPage = lazy(() =>
  import("../pages/ke-toan/phieu-chi").then((m) => ({ default: m.PaymentVouchersPage })));
const PaymentReceiptsPage = lazy(() =>
  import("../pages/ke-toan/phieu-thu").then((m) => ({ default: m.PaymentReceiptsPage })));
const AccountingBankAccountsPage = lazy(() =>
  import("../pages/ke-toan/tk-ngan-hang").then((m) => ({ default: m.AccountingBankAccountsPage })));
const TaiSanPage = lazy(() => import("../pages/tai-san").then((m) => ({ default: m.TaiSanPage })));

/** Tab trình duyệt đang ẩn (người dùng ở tab khác / khoá màn hình điện thoại). */
function tabDangAn(): boolean {
  return typeof document !== "undefined" && document.hidden;
}

import {
  AUTHENTICATED_NAV_IDS,
  MODULES_BY_NAV_ID,
  Sidebar,
  type NavItem,
} from "./Sidebar";
import { Topbar } from "./Topbar";
import { ChuongViec, MobileTabBar, bangMuc } from "./MobileTabBar";
import { theoDoiBanPhim, useLaDienThoai } from "../utils/dienThoai";
import { useTheHoaBang } from "./luoiThe";
import { GoiYBang } from "./LuoiDs";
import { coQuyenBanTo, khoaBanTo } from "./appShellRealtime";
import { khoaTonKho, xemKhoNao } from "../auth/quyenKho";
import { docDeepLinkLsx } from "./appShellDeepLink";

/** A cross-module navigation intent: which screen to open + optional payload so the
 *  target screen can pre-pin a customer or drill straight to a document. */
export interface NavParams {
  /** Pre-pin this customer on the target create flow (CRM → Báo giá / Đơn hàng). */
  customer?: PinnedCustomer;
  /** Open this quotation's detail on the Báo giá screen. */
  openQuoteId?: number;
  /** Open this order's detail on the Đơn hàng bán screen. */
  openOrderId?: number;
  /** Đi kèm `openOrderId`: mở ngăn đơn ở chặng Hóa đơn (liên kết từ Công nợ phải thu). */
  openOrderChang?: "hoadon";
  /** Mở thẳng hồ sơ của đúng khách này ở màn Khách hàng (nút "Hồ sơ khách hàng" ở Công nợ phải thu). */
  openCustomerId?: number;
  /** Mở thẳng hồ sơ của đúng NCC này ở màn Nhà cung cấp (nút "Hồ sơ nhà cung cấp" ở Công nợ phải trả). */
  openSupplierId?: number;
  /** Liên thông: mở Chấm công / Nghỉ phép / Lương lọc theo đúng nhân viên này. */
  focusEmployeeId?: number;
  /** Liên thông từ Hồ sơ NV, nút "Đặt ca nền" (bản rà E6, 07/09/2026): mở Chấm công ở tab
   *  Khai ca, lưới Phân ca tháng lọc sẵn + mở form ca nền cho đúng `focusEmployeeId`. Không có
   *  nó thì `focusEmployeeId` mở tab Nhật ký như cũ. */
  chamCongTab?: "khai-ca" | "my-timesheet";
  /** Liên thông: mở màn Yêu cầu mua hàng (YCMH) lọc + tô sáng đúng mã phiếu này. */
  focusRequestCode?: string;
  /** Kèm `focusRequestCode` mã YCMH (07/10/2026): màn Mua hàng mở luôn form lập đơn cho yêu cầu đó
   *  — nút "Lập đơn mua cho N món" ở chi tiết yêu cầu. */
  lapDonTuYeuCau?: boolean;
  /** Liên thông từ 3 đèn ở Kế hoạch SX: mở Kế hoạch vật tư / Xếp lịch với ô tìm điền sẵn mã lệnh.
   *  Không có nó thì bấm chấm chỉ tới được MÀN, còn phải tự dò lệnh trong danh sách — vẫn là đổi
   *  màn, chỉ đỡ được nửa việc. */
  focusLsxMa?: string;
  /** Liên thông: mở màn Phiếu chi / UNC với ô tìm kiếm điền sẵn (mã PC/PMH...). */
  focusVoucherQuery?: string;
  /** Liên thông Đơn mua hàng → Phiếu chi: mở tab "Mua hàng chờ chi", bung sẵn đơn mã này. */
  focusChoChiCode?: string;
  /** Liên thông Mục thu chi → Báo cáo thu chi (số "Đã dùng"): mở báo cáo lọc đúng mục này. */
  locMucThuChi?: number;
  /** Liên thông: mở màn Phiếu thu với ô tìm kiếm điền sẵn (mã PC/PT...). */
  focusReceiptQuery?: string;
  /** Liên thông Phiếu thu → Công nợ phải thu (lỗi 11): tìm theo tên khách và mở ngăn của đúng
   *  khách này. `id` null = không đọc được mã khách, chỉ điền ô tìm. */
  focusReceivableCustomer?: { id: number | null; name: string };
  /** P3 (redesign-bao-gia §6): mở thẳng 1 Phiếu tính giá (link "↳ PTG" từ Báo giá). */
  focusPhieuId?: number;
  /** Liên thông Hồ sơ khách → Tính giá: mở thẳng form phiếu tính giá MỚI (phiếu nháp, chưa ghi DB).
   *  Phiếu tính giá không mang khách hàng — khách chỉ được chọn ở bước Báo giá. */
  taoPhieuTinhGia?: boolean;
  /** Liên thông Kho → YCMH: mở form Yêu cầu mua hàng điền sẵn dòng vật tư (Tên + ĐVT). */
  purchaseSeedLines?: {
    hang_loai?: HangLoai | null;
    hang_id?: number | null;
    item_name: string;
    unit: string;
    quantity: number;
    note?: string | null;
    /** Khổ CẦN (mm) của giấy — đủ hai cạnh, hoặc chỉ rộng (dài 0). */
    kho_rong?: number;
    kho_dai?: number;
  }[];
  purchaseSeedPurpose?: string;
  /** Liên thông Kế hoạch vật tư → YCMH: điền sẵn cả ĐẦU PHIẾU (nguồn + vết lệnh sản xuất), không
   *  chỉ mấy dòng vật tư. `needed_date` để trống — người lập tự gõ ngày cần hàng (18/09/2026). */
  purchaseSeedHeader?: {
    source_type?: DepartmentPurchaseSourceType | null;
    /** Kho gửi `mua_ton`, Kế hoạch vật tư gửi `cho_lsx` (08/10/2026). */
    loai_mua?: "theo_yeu_cau" | "cho_lsx" | "mua_ton" | null;
    needed_date?: string | null;
    related_document_type?: string | null;
    related_document_code?: string | null;
  };
  /** Liên thông Kế hoạch vật tư → YCMH: yêu cầu này mua cho lệnh/bài nào (khoá các dòng đã tick).
   *  Gửi kèm lúc Lưu để ngày cần hàng vừa gõ quay về đúng các lệnh đó trên Kế hoạch vật tư. */
  purchaseSeedNguon?: CanDoiKhoaDong[];
  /** Liên thông Đơn hàng → bàn Kế hoạch SX: mở thẳng đơn này ở hàng chờ / danh sách lệnh. */
  openSxOrderId?: number;
  /** Liên thông sơ đồ Bài ghép → Kế hoạch SX: mở thẳng chi tiết một lệnh. */
  openLsxId?: number;
  /** Liên thông lệnh → Bài ghép (dòng chỉ đọc "đi chung bài ghép" của gia công ngoài): mở thẳng
   *  chi tiết một bài ghép. */
  openBaiGhepId?: number;
  /** Liên thông Phòng ban → Lương: mở thẳng tab "Cấu hình lương" (bảng lương của tổ). */
  luongTab?: "cauhinh" | "phieu";
  /** Deep-link QR tem kho: mở thẳng drawer lô + vị trí của đúng vật tư này trên màn Tồn kho. */
  /** Deep-link tem QR: khoá mặt hàng gốc dạng `"giay:12"`. */
  openMatHangKey?: string;
  /** Liên thông Đơn mua → Kho: bấm "Nhập kho" ở một đợt giao → mở form Yêu cầu NHẬP điền sẵn. */
  khoNhapSeed?: KhoNhapSeed;
  /** Bấm 1 thông báo kho → mở đúng yêu cầu: `view` chọn tab (Yêu cầu/Hộp), `id` = request_id. */
  khoOpenRequest?: { id: number; view: "denghi" | "yeucau" };
  /** Deep link QR phiếu công nghệ (Task 14): tổ trưởng quét mã dán ở máy → mở thẳng hồ sơ MỘT
   *  lệnh trên màn "Hồ sơ lệnh sản xuất". Nguồn: hash `#lsx=<id>&pv=<phien_ban_in>` đọc lúc
   *  AppShell mount (`appShellDeepLink.ts`), KHÔNG phải một mục Sidebar bấm tay. */
  openHoSoLsxId?: number;
  /** Đi kèm `openHoSoLsxId`: phiên bản phát hành đang IN TRÊN TỜ GIẤY đã quét. Hồ sơ so số này với
   *  `phien_ban` hiện tại của lệnh để báo "phiếu giấy này là bản cũ" khi lệch — xem
   *  `LenhSxNgan`. `null` = QR không mang `pv` (không có gì để so, không bày băng). */
  openHoSoPv?: number | null;
  /** Số thứ tự tăng dần MỖI LƯỢT gọi `navigate(...)` (xem `navigate` bên dưới) — bất kể tới màn
   *  nào, bất kể tham số gì. KHÔNG phải "cái gì trong params đã đổi" mà là "đây có phải MỘT LƯỢT
   *  ĐIỀU HƯỚNG MỚI hay không", kể cả khi mọi giá trị nguyên thuỷ khác giống hệt lượt trước (Task
   *  14, lỗi N1 vòng rà lại: quét LẠI đúng tờ giấy vừa đóng thì `openHoSoLsxId`/`openHoSoPv` ra
   *  cùng một cặp số như lần trước, effect của màn đích không có gì để phân biệt hai lượt).
   *  Hạ tầng CHUNG (tăng cho MỌI lượt `navigate`, không riêng gì deep link), nhưng vòng sửa 2 này
   *  CHỈ nối dây cho `LenhSanXuatPage` — 19 nhánh còn lại của `renderContent()` chưa đọc trường
   *  này, hành vi của chúng không đổi. Màn nào sau này cần "điều hướng lại tới cùng chỗ với cùng
   *  tham số vẫn phải coi là một việc mới" thì đưa trường này vào deps effect của chính nó. */
  navSeq?: number;
}

export type NavigateFn = (id: string, params?: NavParams) => void;

export function AppShell() {
  const { token, user } = useAuth();
  // Link có dấu `?man=<màn>` (màn kế toán ghi trạng thái lọc + kỳ lên URL, đặc tả A.18): vào
  // thẳng màn đó — tải lại trang hay mở link đồng nghiệp gửi đều thấy đúng danh sách. Màn không
  // có quyền thì nhánh `allowed` bên dưới hiện 403 như mọi lối vào khác.
  const [activeId, setActiveId] = useState(() => manTrenUrl() ?? "ho-so-cua-toi");
  const [navParams, setNavParams] = useState<NavParams | null>(null);
  // Ngăn kéo điều hướng ở màn hẹp (≤1024px). Màn rộng: sidebar cố định, cờ này vô hại.
  const [navOpen, setNavOpen] = useState(false);
  const laDT = useLaDienThoai();
  // Điện thoại: bảng danh sách ở mọi màn (kể cả trong hộp thoại / ngăn) thành thẻ — luoiThe.ts.
  useTheHoaBang(laDT);
  // Bàn phím ảo của điện thoại: đo phần màn bị che + đánh dấu "đang gõ" (CSS điện thoại dùng để đẩy
  // bảng đáy / chân hộp lên trên bàn phím và giấu thanh tab dưới).
  useEffect(() => (laDT ? theoDoiBanPhim() : undefined), [laDT]);
  const [readable, setReadable] = useState<Set<string> | null>(null);
  const [caps, setCaps] = useState<Capabilities>(new Map());
  // Chấm đỏ theo nav id (1 = có bản ghi mới chưa xem). Nguồn DUY NHẤT: tóm tắt thông báo
  // (`napThongBao`) — Sidebar chỉ vẽ chấm, không in số.
  const [badges, setBadges] = useState<Record<string, number>>({});
  // Kho đã khai báo → đổ menu con ĐỘNG dưới "Kho hàng" (Cấu hình danh mục). Refetch khi
  // khai báo/sửa/xoá kho (onMutate màn khai báo) → navbar cập nhật NGAY, không cần refresh.
  const [khoList, setKhoList] = useState<{ id: number; ma: string; ten: string }[]>([]);
  // Số yêu cầu ĐÃ DUYỆT chờ kho lập phiếu (badge Nhập/Xuất) + phản hồi kho chưa xem của NGƯỜI TẠO
  // (done_unseen=Hoàn tất, fail_unseen=Không thành) — nuôi badge tab Yêu cầu + số đỏ bộ lọc.
  const [khoCounts, setKhoCounts] = useState<{
    nhap: number;
    xuat: number;
    dieu_chuyen: number;
    done_unseen: number;
    fail_unseen: number;
  }>({ nhap: 0, xuat: 0, dieu_chuyen: 0, done_unseen: 0, fail_unseen: 0 });
  // Bàn "Thực hiện sản xuất": tổ đã khai báo → node lá ĐỘNG dưới section "Sản xuất" + badge =
  // số việc chờ. `teams` MỘT cú gọi ra cả list lẫn badge (`so_viec_cho`) — đừng thêm API badge
  // riêng. Refetch khi có sự kiện `san_xuat_cong_viec_changed` (badge nhảy + bàn đang mở tự tươi).
  const [teamList, setTeamList] = useState<SxTeam[]>([]);
  // Real-time (SSE): toast nổi + mốc 'chờ tôi duyệt' gần nhất để chỉ toast khi TĂNG. Kênh SSE DUY
  // NHẤT ở đây (trang con mở kênh riêng = tốn kết nối + lệch trạng thái).
  // Tick THEO NHÓM (28/09/2026, trước là một `quoteTick` chung cho mọi màn): mỗi màn nhận tổng tick
  // các nhóm nó nghe (`tickCua`), sự kiện nhóm khác không bắt nó nạp lại. Xem `lib/suKienNhom`.
  const [tick, setTick] = useState<TickNhom>(tickRong);
  const tickCua = (...nhom: NhomSuKien[]) => tongTick(tick, nhom);
  // Gộp nhịp 400 ms + hoãn khi tab ẩn. Tạo MỘT lần (setTick ổn định danh tính).
  const boGopRef = useRef<ReturnType<typeof taoBoGopNhip>>(null as unknown as ReturnType<typeof taoBoGopNhip>);
  if (!boGopRef.current) {
    boGopRef.current = taoBoGopNhip({
      choMs: 400,
      dangAn: tabDangAn,
      xa: (ds) =>
        setTick((t) => {
          const n = { ...t };
          for (const g of ds) n[g] += 1;
          return n;
        }),
    });
  }
  // Lượt nạp badge theo sự kiện: gộp 800 ms theo khoá.
  const hoanNapRef = useRef<ReturnType<typeof taoHoanNap>>(null as unknown as ReturnType<typeof taoHoanNap>);
  if (!hoanNapRef.current) hoanNapRef.current = taoHoanNap();
  useEffect(() => () => {
    boGopRef.current.huy();
    hoanNapRef.current.huy();
  }, []);
  // Đã bỏ lượt nạp badge vì tab đang ẩn ⇒ nạp lại một lần khi tab hiện.
  const boLoBadge = useRef(false);
  const xuLySuKienRef = useRef<(e: QuoteEvent) => void>(() => {});
  // Nạp lại TOÀN BỘ số đếm (badge + danh sách tổ) — dùng khi tab hiện lại / kênh nối lại.
  const napLaiTatCaRef = useRef<() => void>(() => {});
  // Tách khỏi tick nhóm — xem lý do ở nhánh `nhat_ky_moi` của kênh SSE bên dưới.
  const [nhatKyTick, setNhatKyTick] = useState(0);
  // Tín hiệu ĐÍCH DANH cho bàn tổ: SỐ LẦN đề nghị cấp vật tư đổi, ĐẾM THEO TỪNG công việc. Tách
  // khỏi tick nhóm có chủ đích — sự kiện này broadcast toàn hệ, đẩy vào tick chung là bắt mọi
  // màn đang mở của cả nhà máy gọi lại API mỗi lần một tổ bấm gửi (xem nhánh SSE bên dưới).
  // Đếm theo công việc chứ không phải một `{n, congViecId}` chung: hai sự kiện rơi cùng một nhịp
  // React thì cái sau ghi đè `congViecId` của cái trước, và nếu cái bị đè đúng là việc đang mở thì
  // drawer im luôn. Dạng bản đồ cũng khỏi cần cửa sổ "mấy sự kiện chưa xem" ở phía nhận.
  const [vatTuDeNghiDem, setVatTuDeNghiDem] = useState<Record<number, number>>({});
  // Cùng khuôn đếm-theo-id cho tệp đính kèm của lệnh: chỉ màn chi tiết ĐÚNG lệnh đó nạp lại danh
  // sách tệp, các màn khác (và chính danh sách lệnh) không bị kéo gọi API theo.
  const [lsxDinhKemDem, setLsxDinhKemDem] = useState<Record<number, number>>({});
  const [toasts, setToasts] = useState<{ id: number; text: string; tone: "ok" | "warn" | "info" }[]>([]);
  const toastSeq = useRef(0);
  // Một cú bấm Bật/Nhả giữ chỗ đẻ HAI event (`bat()` báo công tắc đổi, `nhat_them()` báo vừa
  // nhặt được dòng mới) — cả hai đều cần cho máy khác đang mở màn, nhưng người bấm thì thấy
  // hai toast giống hệt nhau. Gộp trong 2 giây.
  const lastKhvtToast = useRef(0);
  // CÙNG khuôn throttle với `lastKhvtToast` (mốc thời gian + cửa 2 giây), nhưng mốc RIÊNG: dùng
  // chung một mốc cho hai loại toast khác nhau là chúng nuốt lẫn của nhau.
  const lastVatTuToast = useRef(0);
  // Công việc mà bàn "Thực hiện sản xuất" đang mở drawer. Không bắn toast cho chính việc đó:
  // drawer đã tự nạp lại (đếm bên dưới), còn người vừa bấm thì đã ăn toast của `mutate` rồi.
  const cvDangMo = useRef<number | null>(null);
  const datCvDangMo = useCallback((id: number | null) => { cvDangMo.current = id; }, []);
  const activeIdRef = useRef(activeId);
  // Tăng mỗi lượt `navigate(...)` — xem `navSeq` trong `NavParams` và `navigate` bên dưới.
  const navSeqRef = useRef(0);
  // Giữ tham số `ms` (thông báo kho hiện lâu 9s) — luồng thông báo-theo-phòng dùng.
  const pushToast = useCallback(
    (text: string, tone: "ok" | "warn" | "info", ms = 6000) => {
      const id = ++toastSeq.current;
      setToasts((prev) => [...prev, { id, text, tone }]);
      setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), ms);
    },
    [],
  );

  // Single navigation entrypoint: switches the active screen AND carries an optional
  // payload (pinned customer / document to open). A fresh params OBJECT each call does
  // NOT by itself make the target screen's effect re-fire — every current consumer
  // destructures primitive fields out of it (`navParams?.xxx`), and React's dependency
  // check compares those primitives by value, not the wrapping object by identity. Two
  // calls carrying the same primitive values (e.g. re-navigating to the same doc) look
  // identical to such an effect. `navSeq` below exists to break that tie when a screen
  // needs "navigated again" to count as a change even with unchanged params (Task 14,
  // lỗi N1: quét lại đúng QR vừa đóng thì không mở lại gì).
  const navigate = useCallback<NavigateFn>((id, params) => {
    setActiveId(id);
    setNavParams({ ...(params ?? {}), navSeq: ++navSeqRef.current });
    // Chọn xong một mục thì đóng ngăn kéo — không thì ở điện thoại nó che hết màn vừa mở.
    setNavOpen(false);
  }, []);

  // Deep link QR phiếu công nghệ (Task 14, ruling C105/C108): đọc `#lsx=&pv=` lúc AppShell mount
  // rồi tự nhảy thẳng vào đúng hồ sơ — tổ trưởng quét mã xong không phải tự dò lệnh trong bảng.
  // Chỗ đọc CHỈ ở đây vì AppShell chỉ mount khi ĐÃ có phiên (App.tsx); hash SỐNG SÓT qua lượt đăng
  // nhập vì `LoginPage` không đụng `window.location` (bài canh: `LoginPage.test.tsx`).
  // KHÔNG tự kiểm quyền lần hai ở đây — lệnh ngoài phạm vi thì `ho_so.ho_so()` phía backend đã
  // chặn (404/403), `LenhSxNgan` chỉ việc hiện lỗi đó tử tế (ruling C108).
  //
  // Sửa vòng 1 (P2): KHÔNG được chỉ đọc MỘT LẦN lúc mount. Tổ trưởng đã mở sẵn hệ thống trong tab
  // đó (AppShell đã mount, hash lần trước đã bị `replaceState` xoá) rồi quét mã THỨ HAI — trình
  // duyệt chỉ đổi phần fragment của URL, đó là same-document navigation nên KHÔNG reload, KHÔNG
  // remount, effect mount-một-lần không chạy lại ⇒ im lặng không làm gì. Sự đổi hash đó tự nó vẫn
  // bắn sự kiện `hashchange` dù không load lại trang, nên nghe thêm sự kiện đó, DÙNG CHUNG một hàm
  // xử lý với lượt mount (không chép hai bản logic).
  useEffect(() => {
    const doDeepLink = () => {
      const dl = docDeepLinkLsx(window.location.hash);
      if (!dl) return;
      navigate("lenh-san-xuat", { openHoSoLsxId: dl.lsxId, openHoSoPv: dl.pv });
      // Xoá hash NGAY sau khi dùng: nó chỉ có nghĩa lúc VÀO CỬA. Để nguyên thì F5 giữa lúc điều độ
      // đang xem một lệnh KHÁC lại kéo họ về đúng lệnh cũ trên QR — URL không còn đại diện cho màn
      // đang mở (`AppShell` không đồng bộ URL với `activeId`/`navParams`, xem đầu file).
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    };
    doDeepLink();
    window.addEventListener("hashchange", doDeepLink);
    return () => window.removeEventListener("hashchange", doDeepLink);
  }, [navigate]);

  // Esc đóng ngăn kéo (bàn phím + máy đọc màn hình đều cần đường thoát ngoài nút hamburger).
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setNavOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navOpen]);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  // URL luôn mang `?man=<màn đang mở>` (E2E 18/10/2026, lỗi #2): trước đây dấu này chỉ do màn con có
  // bộ lọc ghi, nên sang Chấm công / mở một phiếu tính giá là URL trơ về `/` và tải lại rơi về màn
  // mặc định. Màn con cứ ghi khoá lọc của nó; dấu `man` là việc của AppShell vì chỉ nó biết màn nào
  // đang mở. Cleanup chạy trước effect của lượt đổi màn kế tiếp nên không để sót dấu của màn cũ.
  useEffect(() => {
    datManDangMo(activeId);
    return () => boManDangMo(activeId);
  }, [activeId]);

  // Số thứ tự lượt hỏi quyền: lượt cũ về muộn (hoặc về sau khi đổi phiên) thì bỏ, đừng đè lượt mới.
  const luotHoiQuyen = useRef(0);
  // Bộ quyền đang áp (dạng chuỗi) để nhận ra lượt hỏi lại trả về y hệt.
  const quyenDangAp = useRef<string | null>(null);
  // Lượt hỏi quyền ĐẦU TIÊN hỏng (mạng chập, máy chủ đang khởi động lại). Trước đây gán menu rỗng
  // im lặng ⇒ người dùng thấy app trống trơn, tưởng bị rút hết quyền. Nay hiện lỗi + nút Thử lại.
  const [loiQuyen, setLoiQuyen] = useState<string | null>(null);
  const reloadAccess = useCallback((baoNeuDoi = false) => {
    const luot = ++luotHoiQuyen.current;
    if (!token) return;
    setLoiQuyen(null);
    api
      .myAccess(token)
      .then((acc) => {
        if (luot !== luotHoiQuyen.current) return;
        // Y hệt bộ đang áp ⇒ giữ nguyên `readable`/`caps`: đổi tham chiếu là kênh SSE (phụ thuộc
        // hai giá trị này) đóng rồi nối lại vô cớ, sự kiện bắn trúng khe đó bị rơi.
        const dauVet = JSON.stringify(acc);
        if (dauVet === quyenDangAp.current) return;
        const lanDau = quyenDangAp.current === null;
        quyenDangAp.current = dauVet;
        // Các API "của tôi" tự giới hạn theo hồ sơ đăng nhập, không cần cấp
        // `luong:read` (quyền quản trị). Module ảo này chỉ mở cửa menu tự phục vụ.
        // `self_service` KHÔNG còn được nhét thêm ở đây (10/08/2026): nó là ô quyền thật, do
        // máy chủ trả về như mọi module khác. Nhét tay = giao diện tưởng ai cũng có, bấm vào
        // thì API trả 403 — hai nơi nói hai kiểu.
        setReadable(new Set(acc.modules));
        setCaps(buildCapabilities(acc.permissions));
        if (baoNeuDoi && !lanDau) pushToast("Quyền của bạn vừa được cập nhật.", "info");
      })
      .catch((err: unknown) => {
        if (luot !== luotHoiQuyen.current) return;
        // Lượt ĐẦU hỏng ⇒ chưa có gì để giữ: báo lỗi + Thử lại (xem `loiQuyen`). Lượt tải lại (sau
        // khi lưu vai trò) hỏng ⇒ giữ bộ quyền đang có; xoá sạch thì menu biến mất chỉ vì một cú
        // mạng chập.
        if (quyenDangAp.current === null) {
          setLoiQuyen(err instanceof ApiError ? err.message : "Không tải được quyền truy cập.");
        }
      });
  }, [token, pushToast]);
  useEffect(() => {
    reloadAccess();
    return () => {
      luotHoiQuyen.current++;
      quyenDangAp.current = null;
    };
  }, [reloadAccess]);
  // Màn tự gọi tải lại (vừa lưu vai trò của chính mình) đã có toast "Đã lưu" riêng — không báo thêm.
  const taiLaiQuyenTuMan = useCallback(() => reloadAccess(false), [reloadAccess]);

  // Chấm đỏ thanh bên: MỘT lượt hỏi cho mọi mục (29/09/2026 — thay ~15 lượt đếm riêng). Có bản ghi
  // mới ⇒ chấm; đang đứng trong màn đó ⇒ coi như đã xem (đánh dấu luôn, không chấm). Toast khi id
  // MỚI NHẤT của kênh tăng so với lượt trước (lượt đầu sau đăng nhập thì im).
  const lastThongBao = useRef<Record<string, number> | null>(null);
  // Mở app bắn 8–9 lượt tóm tắt liền nhau (effect sau khi có quyền, SSE mở, các màn báo
  // `onBadgeStale` lúc gắn) — đo tải 30/09/2026 đây là endpoint nặng nhất giữa ca. Đang có lượt
  // bay thì chỉ ĐÁNH DẤU, xong lượt đó hỏi lại đúng MỘT lần: số lần gọi không theo số nguồn kích.
  const thongBaoDangHoi = useRef(false);
  const thongBaoHoiLai = useRef(false);
  const napThongBaoRef = useRef<() => void>(() => {});
  const napThongBao = useCallback(() => {
    if (!token || readable === null) return;
    if (thongBaoDangHoi.current) {
      thongBaoHoiLai.current = true;
      return;
    }
    thongBaoDangHoi.current = true;
    api.moduleNotifications
      .summary(token)
      .then((s) => {
        const dangMo = activeIdRef.current;
        const truoc = lastThongBao.current;
        const cham: Record<string, number> = {};
        for (const [kenh, tb] of Object.entries(s.kenh)) {
          const nav = navCuaKenh(kenh);
          if (!nav) continue;
          if (nav === dangMo || nav === dangMo.split(":")[0]) {
            void api.moduleNotifications.markRead(token, kenh).catch(() => {});
            continue;
          }
          cham[nav] = 1;
          if (truoc && tb.id > (truoc[kenh] ?? 0)) {
            const loi = loiNhacCua(tb.loai, tb.ma);
            if (loi) pushToast(loi, "info");
          }
        }
        lastThongBao.current = Object.fromEntries(
          Object.entries(s.kenh).map(([k, t]) => [k, t.id]),
        );
        setBadges(cham);
      })
      .catch(() => {})
      .finally(() => {
        thongBaoDangHoi.current = false;
        if (thongBaoHoiLai.current) {
          thongBaoHoiLai.current = false;
          napThongBaoRef.current();
        }
      });
  }, [token, readable, pushToast]);
  napThongBaoRef.current = napThongBao;

  // Mở màn = đã xem: tắt chấm NGAY rồi dời mốc ở máy chủ; lỗi thì hỏi lại tóm tắt.
  const markModuleNotificationsRead = useCallback(
    (kenh: string) => {
      if (!token) return;
      const nav = navCuaKenh(kenh);
      if (nav) setBadges((prev) => (prev[nav] ? { ...prev, [nav]: 0 } : prev));
      api.moduleNotifications.markRead(token, kenh).catch(() => napThongBao());
    },
    [token, napThongBao],
  );
  const markThuMuaNotificationsRead = useCallback(
    () => markModuleNotificationsRead("thu_mua"),
    [markModuleNotificationsRead],
  );
  const markKeToanNotificationsRead = useCallback(
    () => markModuleNotificationsRead("ke_toan"),
    [markModuleNotificationsRead],
  );

  // Số tab TRONG màn Kho (Nhập/Xuất/Điều chuyển + phản hồi chưa xem) — chỉ nạp khi màn Kho đang
  // mở; chấm đỏ của mục Kho thì đi theo kênh `kho` như mọi mục khác.
  const napSoKho = useCallback(() => {
    if (!token || readable === null || !readable.has("kho")) return;
    if (activeIdRef.current.split(":")[0] !== "kho-main") return;
    api.kho.deNghi.counts(token).then(setKhoCounts).catch(() => {});
  }, [token, readable]);

  // Giữ TÊN `reloadBadges`: hàng chục màn nhận nó qua `onBadgeStale`. Một lượt tóm tắt + số trong màn
  // Kho — thiếu vế sau thì đánh dấu đã xem xong chấm "phản hồi chưa xem" ở tab Yêu cầu vẫn kẹt.
  const reloadBadges = useCallback(() => {
    napThongBao();
    napSoKho();
  }, [napThongBao, napSoKho]);
  useEffect(() => {
    reloadBadges();
  }, [reloadBadges]);

  // Danh sách kho cho menu con động (người có quyền `kho`, hoặc Xem ở một dòng kho `ton_kho_<id>`).
  // Gọi lại sau mỗi lần khai báo kho.
  const reloadKho = useCallback(() => {
    if (!token || readable === null || !(readable.has("kho") || xemKhoNao(readable))) return;
    crud("/api/kho")
      .list(token, { active: true })
      .then((r) => setKhoList(r.items.map((w) => ({ id: Number(w.id), ma: String(w.ma), ten: String(w.ten) }))))
      .catch(() => {});
  }, [token, readable]);
  useEffect(() => { reloadKho(); }, [reloadKho]);

  // Danh sách bàn tổ (chỉ người có Xem ở ít nhất một dòng quyền theo tổ). MỘT cú gọi ra cả list
  // (đổ node lá, đã theo thứ tự cây) lẫn badge (`so_viec_cho`). Gọi lại sau mỗi sự kiện bàn tổ đổi (SSE).
  const reloadTeams = useCallback(() => {
    if (!token || readable === null) return;
    // Vừa bị rút hết quyền bàn tổ (tải lại quyền sau khi lưu vai trò) ⇒ bỏ danh sách cũ luôn.
    if (!coQuyenBanTo(readable)) {
      setTeamList([]);
      return;
    }
    api.sanXuat
      .teams(token)
      .then((r) => setTeamList(r.teams))
      .catch(() => {});
  }, [token, readable]);
  useEffect(() => { reloadTeams(); }, [reloadTeams]);
  // Tổ cha không có bàn (chỉ tổ lá nhận việc): link cũ, toast hay URL trỏ vào tổ cha ⇒ sang tổ lá
  // đầu tiên của nhánh, đừng mở bàn gộp việc mọi tổ con.
  useEffect(() => {
    if (!activeId.startsWith("thuc-hien-sx:")) return;
    const la = toLaDauTien(teamList, Number(activeId.split(":")[1]));
    if (la != null) setActiveId(`thuc-hien-sx:${la}`);
  }, [activeId, teamList]);
  useEffect(() => {
    napLaiTatCaRef.current = () => {
      reloadBadges();
      reloadTeams();
    };
  }, [reloadBadges, reloadTeams]);
  // Real-time luồng gửi duyệt (CLAUDE.md "gửi nội bộ = real-time"): mở 1 kênh SSE sau đăng nhập →
  // GĐ thấy 'chờ duyệt' ngay khi Sale trình; Sale thấy 'đã duyệt/từ chối' ngay khi GĐ quyết. Đóng
  // khi logout/đổi bộ quyền.
  //
  // MỌI tài khoản đăng nhập đều mở (17/09/2026). Trước đó chỉ mở khi có Xem ở một danh sách module
  // "có thời gian thực" — nên tài khoản chưa có vai hoặc vai chỉ có màn tĩnh không bao giờ nghe
  // được `quyen_doi`: được gán vai xong vẫn đứng nhìn menu trống tới khi F5. Danh sách đó còn chép
  // hai lần lệch nhau (bản thứ hai thiếu Bài ghép, Xếp lịch, Hồ sơ lệnh SX) và chặn luôn các tin
  // gửi đích danh cho chính người đó (đổi ca, chuông) — thứ vốn không cần quyền module nào.
  //
  // Từ 28/09/2026 (sức chịu tải A3): kênh MỞ MỘT LẦN mỗi phiên, không đóng/mở lại theo bộ quyền
  // hay token xoay — bộ xử lý đọc state mới nhất qua ref. Sự kiện chỉ đánh dấu NHÓM bẩn (xem
  // `lib/suKienNhom`), 400 ms sau mới nhích tick một lần; các lượt nạp badge gộp 800 ms theo khoá;
  // tab đang ẩn thì chỉ đánh dấu, hiện lại mới nạp. Toast vẫn hiện NGAY.
  function xuLySuKien(e: QuoteEvent) {
    if (!token || readable === null) return;
    const boGop = boGopRef.current;
    // Nạp badge theo sự kiện: gộp theo khoá; tab ẩn thì bỏ lượt, ghi nhớ để nạp một lần khi hiện lại.
    const napBadge = (khoa: string, fn: () => void) => {
      if (tabDangAn()) {
        boLoBadge.current = true;
        return;
      }
      hoanNapRef.current.hoanNap(khoa, fn);
    };
    // Quyền của CHÍNH người này vừa đổi (vai của họ được lưu lại ma trận, được gán/gỡ vai, đổi
    // phòng). Máy chủ đã gác theo quyền mới từ request kế tiếp; menu + nút thì phải hỏi lại.
    if (e.type === "quyen_doi") {
      reloadAccess(true);
      return;
    }
    // Hàng đợi của kết nối này tràn (mạng chậm, tab ngủ): máy chủ bỏ các sự kiện đang xếp và để lại
    // đúng tín hiệu này ⇒ làm như lúc kênh nối lại. Không toast.
    if (e.type === "dong_bo_lai") {
      dongBoLaiRef.current();
      return;
    }
    // Nhật ký có dòng mới. TICK RIÊNG, cố ý không đụng tick nhóm: mọi thao tác trong hệ đều
    // ghi một dòng audit, đẩy vào tick chung là bắt MỌI màn đang mở nạp lại theo. Màn Nhật ký
    // cũng không tự chèn dòng vào danh sách người ta đang đọc — nó chỉ hiện băng "có N dòng mới".
    if (e.type === "nhat_ky_moi") {
      setNhatKyTick((n) => n + 1);
      return;
    }
    // Chuyến giao của CHÍNH tài xế này — máy chủ đẩy đích danh nên không lọc quyền lần nữa.
    // Tài xế đang ở kho hoặc trên đường, không ngồi canh màn hình (CLAUDE.md: nội bộ = tức thì).
    if (e.type === "giao_hang_chuyen") {
      boGop.danhDau(nhomCua(e.type));
      pushToast(
        String(e.message ?? "Chuyến giao của bạn vừa cập nhật."),
        e.viec === "kho_xong" || e.viec === "da_xuat_kho" ? "ok" : "info",
      );
      return;
    }
    // Phiếu lương của CHÍNH người này vừa mở (#39) hoặc vừa bị thu hồi (#59) — máy chủ đẩy đích danh,
    // không lọc quyền nữa; màn Phiếu lương nghe nhóm nhân sự nên tự nạp lại.
    if (e.type === "phieu_luong_cong_bo" || e.type === "phieu_luong_thu_hoi") {
      boGop.danhDau(nhomCua(e.type));
      pushToast(String(e.message ?? "Phiếu lương của bạn vừa đổi."), "info");
      return;
    }
    // Đề nghị cấp vật tư của MỘT công đoạn vừa đổi. Máy chủ gửi đích danh tổ của bước, nên chỉ
    // bàn tổ đó nhận: đẩy `cong_viec_id` xuống để drawer đang mở việc đó nạp lại, và nhích nhóm
    // `san_xuat` để cột Vật tư của lưới đổi theo (18/10/2026). Toast vẫn gác quyền Xem bàn tổ.
    if (e.type === "san_xuat_vat_tu_de_nghi_changed") {
      if (coQuyenBanTo(readable)) {
        boGop.danhDau(nhomCua(e.type));
        const cv = e.cong_viec_id;
        setVatTuDeNghiDem((m) => ({ ...m, [cv]: (m[cv] ?? 0) + 1 }));
        // Cổng thứ 3: KHÔNG toast cho việc người này đang mở (drawer vừa tươi, và nếu chính họ
        // bấm thì `mutate` đã toast rồi) và gộp trong 2 giây — không thì mỗi lần bất kỳ tổ nào
        // trong nhà máy bấm gửi là mọi người xem được bàn tổ ăn một toast.
        const gio = Date.now();
        if (cv !== cvDangMo.current && gio - lastVatTuToast.current > 2000) {
          lastVatTuToast.current = gio;
          pushToast("📦 Đề nghị cấp vật tư của công đoạn vừa cập nhật", "info");
        }
      }
      return;
    }
    // Tệp đính kèm của lệnh: không toast (không phải việc gửi tới ai), không bump tick chung.
    // Ba nơi đọc: tab Tệp của Kế hoạch SX, thẻ "Tệp của lệnh" trong drawer Bàn tổ (tổ không có
    // module `san_xuat`, vào bằng quyền theo tổ) và màn KCS (nút Tệp của lệnh + hộp Ghi lỗi).
    if (e.type === "lsx_dinh_kem_changed") {
      if (readable.has("san_xuat") || readable.has("kcs") || coQuyenBanTo(readable)) {
        const id = e.lsx_id;
        setLsxDinhKemDem((m) => ({ ...m, [id]: (m[id] ?? 0) + 1 }));
      }
      return;
    }
    // Đánh dấu nhóm của sự kiện: màn đang mở nghe nhóm đó sẽ nạp lại (gộp nhịp 400 ms).
    boGop.danhDau(nhomCua(e.type));
    // Giữ chỗ vật tư vừa đổi (bật/tắt/nhặt thêm/hàng về/đối soát PMH) — tick ở trên đã bump nên
    // màn Kế hoạch vật tư tự tải lại; chỉ cần báo cho người đang mở màn khác biết số đã đổi.
    if (e.type === "ke_hoach_vat_tu_thay_doi") {
      const gio = Date.now();
      if (gio - lastKhvtToast.current > 2000) {
        lastKhvtToast.current = gio;
        pushToast("Kế hoạch vật tư vừa cập nhật.", "info");
      }
      return;
    }
    if (e.type === "quote_decision") {
      pushToast(
        e.decision === "approved"
          ? `✓ Báo giá ${e.code} đã được duyệt`
          : `✕ Báo giá ${e.code} bị từ chối`,
        e.decision === "approved" ? "ok" : "warn",
      );
      napBadge("tat_ca", reloadBadges);
    } else if (readable.has("bao_gia") && e.type === "quote_pending_changed") {
      // Chấm đỏ + lời nhắc "chờ bạn duyệt" nay đi theo kênh `bao_gia` (sự kiện `thong_bao_man`).
      napBadge("tat_ca", reloadBadges);
    // Nhánh `order_decision` (duyệt/từ chối đơn đặc thù) đã gỡ cùng luồng duyệt — backend
    // không còn publish event này nữa.
    } else if (readable.has("don_hang_ban") && e.type === "order_deposit_ok") {
      pushToast(`🔔 Đơn ${e.code} đã đủ cọc — chuyển xuống sản xuất được rồi`, "info");
      napBadge("tat_ca", reloadBadges);
    } else if (readable.has("don_hang_ban") && e.type === "order_pending_changed") {
      napBadge("tat_ca", reloadBadges);
    } else if (e.type === "shift_changed") {
      // Ca của TÔI bị đổi: chấm + lời nhắc đi theo kênh `cham_cong` (đích danh).
      napBadge("tat_ca", reloadBadges);
    } else if (
      e.type === "order_ordered" ||
      e.type === "lsx_changed" ||
      e.type === "bai_ghep_changed" ||
      e.type === "xep_lich_changed"
    ) {
      // Nội dung màn tự refetch qua tick nhóm; chấm đỏ đi theo kênh `san_xuat`/`xep_lich`.
      if (readable.has("san_xuat") && e.type === "order_ordered") {
        pushToast(`🔔 Đơn ${e.code ?? ""} vừa chuyển xuống sản xuất`.trim(), "info");
      }
      napBadge("tat_ca", reloadBadges);
    } else if (coQuyenBanTo(readable) && e.type === "san_xuat_cong_viec_changed") {
      // Bàn tổ đổi (giao người / bắt đầu / tạm dừng / kết thúc / phát hành) → badge tổ nhảy
      // NGAY; nhóm sự kiện đã được đánh dấu ở đầu handler nên bàn đang mở tự refetch (không refresh).
      // `teams` mang cả `so_viec_cho` nên reloadTeams lo luôn badge — không gọi API badge riêng.
      napBadge("to_sx", reloadTeams);
    } else if (coQuyenBanTo(readable) && e.type === "san_xuat_kcs_changed") {
      // KCS ghi/điều chỉnh một lần kiểm, hoặc tổ mở tab KCS (đã xem lỗi) → badge "chờ xác nhận" của tổ
      // bị báo lỗi đổi NGAY; nhóm sự kiện đã được đánh dấu ở đầu handler nên màn KCS, hộp "KCS báo lỗi" và
      // mục "Kết quả KCS" đang mở tự nạp lại (không refresh).
      napBadge("to_sx", reloadTeams);
    } else if (coQuyenBanTo(readable) && e.type === "san_xuat_ban_giao_changed") {
      // Bàn giao giữa hai tổ đổi → badge "chờ xác nhận" của tổ nhảy NGAY;
      // nhóm sự kiện đã được đánh dấu nên hộp "Chờ tổ bạn xác nhận" của bàn đang mở tự nạp lại.
      napBadge("to_sx", reloadTeams);
    } else if (e.type === "san_xuat_ban_giao") {
      // Đẩy ĐÍCH DANH (máy chủ đã lọc người giữ Xác nhận sản lượng trọn tổ bên kia, trừ người bấm).
      const sl = e.so_luong != null ? `${e.so_luong.toLocaleString("vi-VN")} ${nhanDonVi(e.don_vi)}`.trim() : "";
      const tuyen = `${e.nguon_ten || "?"} → ${e.dich_ten || "?"}`;
      if (e.su_kien === "cho_mang_di") {
        // Bàn giao sang dải GIA CÔNG NGOÀI — máy chủ đẩy tới người có quyền sửa lệnh (Task 6).
        pushToast(
          `📦 ${e.nguon_ten || "Bước trước"} vừa giao${sl ? " " + sl : ""} sang “${e.dich_ten || "gia công ngoài"}”${e.lsx_ma ? ` (${e.lsx_ma})` : ""} — chờ mang đi gia công`,
          "info",
          9000,
        );
      } else if (e.su_kien === "xac_nhan") {
        pushToast(`✓ Tổ nhận đã xác nhận bàn giao ${tuyen}${sl ? ` (${sl})` : ""}`, "ok");
      } else if (e.su_kien === "sua_me") {
        // Bên giao sửa số mẻ của lần giao tổ bạn đã nhận ⇒ số đổi ngay, chờ tổ bạn xác nhận lại.
        pushToast(`✏️ ${e.nguon_ten || "Bước trước"} sửa số sản lượng, bàn giao ${tuyen}${sl ? " thành " + sl : ""} — xác nhận lại`, "warn");
      } else if (e.su_kien === "sua") {
        pushToast(`✏️ Bàn giao ${tuyen} vừa sửa${sl ? " còn " + sl : ""} — chờ tổ bạn xác nhận`, "info");
      } else {
        pushToast(`🔔 Bàn giao mới ${tuyen}${sl ? ` (${sl})` : ""} — chờ tổ bạn xác nhận`, "info");
      }
    } else if (e.type === "san_xuat_duoc_giao_viec") {
      // Đẩy đích danh tới người vừa được giao việc (chỉ người có tài khoản nhận) — toast cá nhân.
      pushToast("🔔 Bạn được giao việc sản xuất mới", "info");
    } else if (e.type === "san_xuat_kcs_ket_qua") {
      // KCS vừa kiểm một công đoạn của tổ — đẩy ĐÍCH DANH tới người giữ Xác nhận sản lượng của tổ
      // đó (§ thông báo tổ). Một chiều: tổ mở tab KCS là đã xem, không Nhận/Từ chối.
      const ai = e.nguoi_kiem ? `KCS ${e.nguoi_kiem}` : "KCS";
      const soDat = e.so_dat ?? 0;
      const soLoi = e.so_loi ?? 0;
      const lenh = e.lsx_ma ? ` (${e.lsx_ma})` : "";
      if (e.phat_hien_o) {
        // Lỗi của công đoạn này bị bắt ở bước SAU — KCS quy trách nhiệm về tổ.
        pushToast(
          `⚠️ ${ai} bắt lỗi ${e.ten_cong_doan || "công đoạn"}${lenh} ở bước ${e.phat_hien_o}: ${soLoi.toLocaleString("vi-VN")} ${nhanChang(e.don_vi)}`.trim(),
          "warn",
        );
      } else if (e.la_kcs_cuoi === false) {
        // Công đoạn giữa chỉ ghi lỗi — không có "đạt" để nói.
        pushToast(
          `⚠️ ${ai} ghi lỗi ${e.ten_cong_doan || "công đoạn"}${lenh}: ${soLoi.toLocaleString("vi-VN")} ${nhanChang(e.don_vi)}`.trim(),
          "warn",
        );
      } else {
        const so = `đạt ${soDat.toLocaleString("vi-VN")} và lỗi ${soLoi.toLocaleString("vi-VN")}`;
        pushToast(
          `${soLoi > 0 ? "⚠️" : "✓"} ${ai} đã kiểm ${e.ten_cong_doan || "công đoạn"}${lenh}: ${so}`,
          soLoi > 0 ? "warn" : "ok",
        );
      }
    } else if (e.type === "san_xuat_kho") {
      // Nhập kho thành phẩm là tương tác GIỮA KCS và kho — kho ghi sổ phiếu nhập thì đẩy ĐÍCH DANH
      // tới người tạo yêu cầu (kho đã nhận tới đâu). `trang_thai` = trạng thái yêu cầu kho.
      const t = toastKhoNhapThanhPham(e.trang_thai, e.ma);
      if (t) pushToast(t.chu, t.kieu);
    } else if (
      (readable.has("san_xuat") || readable.has("don_hang_ban")) &&
      e.type === "san_xuat_lenh_dong"
    ) {
      // KCS vừa đóng / mở lại lệnh (cả nhóm) → báo Sale + Kế hoạch SX NGAY.
      const ma = (e.lenh_ma ?? []).join(", ") || "Lệnh";
      const so = e.da_dat != null
        ? ` — đạt ${num(e.da_dat)}${e.muc_tieu != null ? `/${num(e.muc_tieu)}` : ""}${e.don_vi ? ` ${e.don_vi}` : ""}`
        : "";
      pushToast(
        e.kieu === "mo_lai" ? `↩️ ${ma} đã được mở lại` : `✅ ${ma} đã đóng${so}`,
        e.kieu === "mo_lai" ? "warn" : "ok",
      );
    } else if (readable.has("ky_thuat_may") && e.type === "ky_thuat_yeu_cau_moi") {
      // Bộ phận khác vừa báo máy hỏng → ting tổ sửa chữa NGAY. Máy đang dừng thì đổi giọng: đó
      // là khác biệt giữa "lát nữa ghé xem" và "bỏ việc đang làm chạy sang".
      pushToast(
        e.may_dung
          ? `⚠️ ${e.may} đang dừng vì hỏng${e.bo_phan_hong ? ` ${e.bo_phan_hong}` : ""}${e.nguoi_bao ? ` (${e.nguoi_bao} báo)` : ""}`
          : `🔔 ${e.nguoi_bao ?? "Có người"} báo ${e.may} hỏng${e.bo_phan_hong ? ` ${e.bo_phan_hong}` : ""}`,
        e.may_dung ? "warn" : "info",
      );
      napBadge("tat_ca", reloadBadges);
    } else if (readable.has("ky_thuat_may") && e.type === "ky_thuat_phieu_bao_lai") {
      // Máy ĐÃ có phiếu sửa mở mà tổ báo lại (máy dừng / triệu chứng mới, 23/10/2026).
      pushToast(
        e.may_dung
          ? `⚠️ ${e.may} đang dừng vì hỏng${e.nguoi_bao ? ` (${e.nguoi_bao} báo)` : ""}, phiếu ${e.ma}`
          : `🔔 ${e.nguoi_bao ?? "Có người"} báo thêm triệu chứng ${e.may}, phiếu ${e.ma}`,
        e.may_dung ? "warn" : "info",
      );
    } else if (e.type === "ky_thuat_yeu_cau_ket_qua") {
      // Kết quả đẩy riêng về ĐÚNG người đã báo (không broadcast) ⇒ KHÔNG gác quyền: nhận được
      // sự kiện này nghĩa là mình chính là người gửi lời báo đó.
      pushToast(
        e.ket_qua === "da_tao_phieu"
          ? `✅ ${e.ma} đã được tiếp nhận thành phiếu ${e.phieu_ma ?? ""}${e.boi ? ` (${e.boi})` : ""}`
          : `✕ ${e.ma} không lập phiếu: ${e.ly_do ?? ""}`,
        e.ket_qua === "da_tao_phieu" ? "ok" : "warn",
      );
      napBadge("tat_ca", reloadBadges);
    } else if (readable.has("phieu_bao_tri") && e.type === "bao_tri_due") {
      // Tới ngày bảo trì → ting tổ sửa chữa: toast + badge "Phiếu bảo trì" tự nhảy.
      pushToast(
        `${e.qua_han ? "⚠️ Quá hạn bảo trì" : "🔧 Tới hạn bảo trì"}: ${e.may}${e.goi ? ` (${e.goi})` : ""}`,
        e.qua_han ? "warn" : "info",
      );
      napBadge("tat_ca", reloadBadges);
    } else if (readable.has("khach_hang") && e.type === "care_due") {
      // Tới giờ hẹn → ting người phụ trách: toast + badge "Khách hàng" (số việc đến hạn) tự nhảy.
      pushToast(`🔔 Tới hẹn chăm sóc: ${e.customer}${e.note ? " — " + e.note : ""}`, "info");
      napBadge("tat_ca", reloadBadges);
    } else if (readable.has("khach_hang") && e.type === "care_assigned") {
      pushToast(`📋 Bạn có hẹn chăm sóc mới: ${e.customer}${e.note ? " — " + e.note : ""}`, "info");
      napBadge("tat_ca", reloadBadges);
    } else if (readable.has("khach_hang") && e.type === "care_moved") {
      // Người mất hẹn chỉ cần màn nạp lại (nhóm ban_hang đã nhích) — không toast.
      if (e.nhan) pushToast(`📋 Bạn nhận ${e.so} hẹn chăm sóc do điều chuyển khách`, "info");
      napBadge("tat_ca", reloadBadges);
    } else if (e.type === "advance_decision") {
      // Nhân viên đề nghị nhận quyết định của kế toán — đẩy riêng tới đúng người.
      pushToast(
        e.decision === "approved"
          ? "✓ Đề nghị tạm ứng của bạn đã được duyệt"
          : "✕ Đề nghị tạm ứng của bạn bị từ chối",
        e.decision === "approved" ? "ok" : "warn",
      );
      napBadge("tat_ca", reloadBadges);
    } else if (e.type === "ot_decision") {
      // NV nộp phiếu tăng ca nhận quyết định của tổ trưởng — đẩy riêng tới đúng người.
      pushToast(
        e.decision === "approved"
          ? "✓ Phiếu tăng ca của bạn đã được duyệt"
          : e.decision === "cancelled"
            ? "✕ Phiếu tăng ca đã duyệt của bạn vừa bị HUỶ — tối nay không còn giấy phép tăng ca"
            : e.decision === "huy_dong_y"
              ? "✓ Yêu cầu hủy phiếu tăng ca của bạn đã được đồng ý — phiếu đã hủy"
              : e.decision === "huy_giu_nguyen"
                ? "✕ Yêu cầu hủy phiếu tăng ca không được đồng ý — phiếu vẫn giữ, xem lý do ở Tăng ca"
                : "✕ Phiếu tăng ca của bạn bị từ chối",
        e.decision === "approved" || e.decision === "huy_dong_y" ? "ok" : "warn",
      );
      napBadge("tat_ca", reloadBadges);
    } else if (e.type === "leave_decision") {
      // Nghỉ phép (23/09/2026): quyết định về đơn đẩy riêng tới người đứng tên đơn.
      const msg: Record<string, string> = {
        approved: "✓ Đơn nghỉ phép của bạn đã được duyệt",
        rejected: "✕ Đơn nghỉ phép của bạn bị từ chối — xem lý do ở Nghỉ phép",
        cancelled: "✕ Đơn nghỉ đã duyệt của bạn vừa bị HỦY — xem lý do ở Nghỉ phép",
        huy_dong_y: "✓ Yêu cầu hủy đơn nghỉ đã được đồng ý — đơn đã hủy",
        huy_rut_ngan: "✓ Yêu cầu hủy đơn nghỉ đã được đồng ý — đơn được rút ngắn, giữ các ngày đã nghỉ",
        huy_giu_nguyen: "✕ Yêu cầu hủy đơn nghỉ không được đồng ý — đơn vẫn giữ, xem lý do ở Nghỉ phép",
      };
      pushToast(msg[e.decision] ?? "Đơn nghỉ phép của bạn vừa được cập nhật",
        e.decision === "approved" || e.decision === "huy_dong_y" || e.decision === "huy_rut_ngan" ? "ok" : "warn");
      napBadge("tat_ca", reloadBadges);
    } else if (
      (readable.has("nghi_phep") && e.type === "leave_pending_changed") ||
      (readable.has("tang_ca") && e.type === "ot_pending_changed")
    ) {
      napBadge("tat_ca", reloadBadges);
    } else if (e.type === "adjust_decision") {
      // NV gửi yêu cầu chỉnh công nhận quyết định (E7, 08/09/2026) — không phải F5 mới biết bị từ chối.
      pushToast(
        e.decision === "approved"
          ? `✓ Yêu cầu chỉnh công ngày ${e.code ?? ""} đã được duyệt`
          : `✕ Yêu cầu chỉnh công ngày ${e.code ?? ""} bị từ chối — xem lý do ở Chấm công`,
        e.decision === "approved" ? "ok" : "warn",
      );
      napBadge("tat_ca", reloadBadges);
    } else if (readable.has("cham_cong") && e.type === "adjust_pending_changed") {
      // Có yêu cầu chỉnh công mới/huỷ → người duyệt refetch (tab đang mở tự tải lại theo eventTick).
      napBadge("tat_ca", reloadBadges);
    } else if (e.type === "el_decision") {
      // NV nộp phiếu đi muộn / về sớm nhận quyết định của tổ trưởng — đẩy riêng tới đúng người.
      pushToast(
        e.decision === "approved"
          ? "✓ Phiếu đi muộn / về sớm của bạn đã được duyệt"
          : "✕ Phiếu đi muộn / về sớm của bạn bị từ chối",
        e.decision === "approved" ? "ok" : "warn",
      );
      napBadge("tat_ca", reloadBadges);
    } else if (readable.has("cham_cong") && e.type === "el_pending_changed") {
      napBadge("tat_ca", reloadBadges);
    } else if (
      readable.has("thu_mua") &&
      e.type === "department_purchase_request_created" &&
      e.actor_user_id !== user?.id
    ) {
      pushToast(`Có yêu cầu mua hàng${e.code ? " " + e.code : ""} mới từ phòng ban`, "info");
      napBadge("tat_ca", reloadBadges);
    } else if (
      readable.has("ke_toan") &&
      e.type === "purchase_pending_approval" &&
      e.actor_user_id !== user?.id
    ) {
      pushToast(`Có đơn mua hàng${e.code ? " " + e.code : ""} chờ xử lý`, "info");
      napBadge("tat_ca", reloadBadges);
    } else if (
      readable.has("thu_mua") &&
      e.type === "purchase_decision" &&
      e.actor_user_id !== user?.id &&
      (e.recipient_user_id == null || e.recipient_user_id === user?.id)
    ) {
      pushToast(
        e.decision === "approved"
          ? `Đơn mua hàng${e.code ? " " + e.code : ""} đã được duyệt`
          : `Đơn mua hàng${e.code ? " " + e.code : ""} bị từ chối, cần sửa và gửi lại`,
        e.decision === "approved" ? "ok" : "warn",
      );
      napBadge("tat_ca", reloadBadges);
    } else if (
      (readable.has("ke_toan") || readable.has("phieu_chi")) &&
      (e.type === "purchase_delivery_created" ||
        e.type === "purchase_delivery_updated" ||
        e.type === "purchase_delivery_deleted" ||
        e.type === "purchase_invoice_updated") &&
      e.actor_user_id !== user?.id
    ) {
      const code = e.code ? ` ${e.code}` : "";
      if (e.type === "purchase_delivery_created") {
        pushToast(
          `Đơn mua hàng${code} có đợt giao mới${e.seq_no ? ` số ${e.seq_no}` : ""}`,
          "info",
        );
      } else if (e.type === "purchase_delivery_updated") {
        pushToast(`Đợt giao của đơn mua hàng${code} đã được cập nhật`, "info");
      } else if (e.type === "purchase_delivery_deleted") {
        pushToast(`Đợt giao của đơn mua hàng${code} đã được xóa`, "warn");
      } else {
        pushToast(`Hóa đơn của đơn mua hàng${code} đã được cập nhật`, "info");
      }
      napBadge("tat_ca", reloadBadges);
    } else if (
      readable.has("thu_mua") &&
      e.type === "payment_voucher_created" &&
      e.actor_user_id !== user?.id &&
      (e.recipient_user_id == null || e.recipient_user_id === user?.id)
    ) {
      pushToast(
        `Kế toán đã lập chứng từ${e.voucher_code ? " " + e.voucher_code : ""}${
          e.code ? ` cho đơn ${e.code}` : ""
        }`,
        "ok",
      );
      napBadge("tat_ca", reloadBadges);
    } else if (
      readable.has("thu_mua") &&
      e.type === "payment_voucher_cancelled" &&
      e.actor_user_id !== user?.id &&
      (e.recipient_user_id == null || e.recipient_user_id === user?.id)
    ) {
      pushToast(
        `Kế toán đã hủy chứng từ${e.voucher_code ? " " + e.voucher_code : ""}${
          e.code ? ` của đơn ${e.code}` : ""
        }`,
        "warn",
      );
      napBadge("tat_ca", reloadBadges);
    } else if (
      (readable.has("thu_mua") || readable.has("ke_toan")) &&
      (e.type === "purchase_changed" || e.type === "accounting_changed")
    ) {
      napBadge("tat_ca", reloadBadges);
    } else if (
      readable.has("phieu_chi") &&
      (e.type === "gia_cong_cho_chi" || e.type === "gia_cong_cho_chi_changed")
    ) {
      if (e.type === "gia_cong_cho_chi") {
        pushToast(
          `💸 Gia công ${e.ten_viec ?? ""} — ${e.nha_cung_cap_ten ?? ""}${e.lsx_ma ? ` (${e.lsx_ma})` : ""} đã chốt số, chờ lập phiếu chi`,
          "info",
          9000,
        );
      }
      napBadge("tat_ca", reloadBadges);
    } else if (readable.has("luong") && e.type === "advance_pending_changed") {
      napBadge("tat_ca", reloadBadges);
    } else if (readable.has("kho") && e.type === "stock_request") {
      // Tin ĐÍCH DANH của luồng kho (duyệt/từ chối/hủy/cấp…). Câu chữ backend soạn; chèn CHIỀU
      // (nhập/xuất) vào đầu cho cụ thể, hiện lâu hơn (9s).
      const dir = e.loai === "XUAT" ? "xuất" : "nhập";
      const msg = e.message.startsWith("Yêu cầu")
        ? e.message.replace(/^Yêu cầu/, `Yêu cầu ${dir}`)
        : e.message;
      pushToast(msg, "info", 9000);
      napSoKho();
      napBadge("tat_ca", reloadBadges);
    } else if (readable.has("kho") && e.type === "stock_request_pending_changed") {
      // Số tab trong màn Kho (nếu đang mở); chấm + lời nhắc "việc mới" đi theo kênh `kho`.
      napSoKho();
      napBadge("tat_ca", reloadBadges);
    } else if (e.type === "thong_bao_man") {
      napBadge("thong_bao_man", napThongBao);
    }
  }
  useEffect(() => {
    xuLySuKienRef.current = xuLySuKien;
  });
  // Lỡ mất sự kiện (kênh vừa nối lại sau khi đứt, hoặc máy chủ báo `dong_bo_lai` vì hàng đợi của
  // kết nối này tràn): nhích MỌI nhóm để màn đang mở nạp lại + nạp lại mọi badge, kể cả Kế hoạch
  // vật tư. Không toast. Tab đang ẩn thì hoãn tới lúc hiện lại.
  const dongBoLaiRef = useRef<() => void>(() => {});
  dongBoLaiRef.current = () => {
    boGopRef.current.danhDau(MOI_NHOM);
    if (tabDangAn()) {
      boLoBadge.current = true;
      return;
    }
    napLaiTatCaRef.current();
  };
  const coPhien = !!token && readable !== null;
  useEffect(() => {
    if (!token || !coPhien) return;
    const close = connectQuoteEvents(token, (e) => xuLySuKienRef.current(e), {
      // Kênh vừa NỐI LẠI sau khi đứt (deploy, rớt mạng): sự kiện bắn trong lúc đứt đã rơi ⇒ nhích
      // mọi nhóm + nạp lại badge một lần cho khỏi lệch.
      onMo: () => dongBoLaiRef.current(),
    });
    return close;
    // Cố ý CHỈ theo token + "đã có quyền" — xem ghi chú đầu khối. Token React giờ chỉ đổi khi đăng
    // nhập / khôi phục phiên (token xoay ngầm nằm ở `layTokenMoiNhat`).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, coPhien]);

  // Tab hiện lại: xả nhóm bẩn (màn đang mở nạp một lượt) + nạp lại badge nếu đã bỏ lượt lúc ẩn.
  useEffect(() => {
    const onVis = () => {
      if (tabDangAn()) return;
      const coBan = boGopRef.current.khiHien();
      if (coBan || boLoBadge.current) {
        boLoBadge.current = false;
        napLaiTatCaRef.current();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  // Mở màn = đã xem bản ghi mới của kênh màn đó (chấm tắt ngay, mốc dời ở máy chủ).
  useEffect(() => {
    if (!token) return;
    const kenh = kenhCuaNav(activeId);
    if (!kenh) return;
    const nav = navCuaKenh(kenh);
    if (nav && badges[nav]) markModuleNotificationsRead(kenh);
  }, [activeId, token, badges, markModuleNotificationsRead]);
  // Màn Kho mở ⇒ nạp số các tab bên trong (không nạp khi đứng ở màn khác).
  useEffect(() => {
    if (activeId.split(":")[0] === "kho-main") napSoKho();
  }, [activeId, napSoKho]);

  // Mở màn Báo giá = người soạn đã xem các quyết định → đánh dấu seen + hạ badge (giống chuông Nghỉ phép).
  useEffect(() => {
    if (!token || readable === null) return;
    if (activeId.split(":")[0] === "bao-gia" && readable.has("bao_gia")) {
      api.quotations.markDecisionsSeen(token).then(reloadBadges).catch(() => {});
    }
  }, [activeId, token, readable, reloadBadges]);


  if (readable === null) {
    if (loiQuyen) {
      return (
        <div className="shell__center">
          <div className="banner banner--error" role="alert" style={{ textTransform: "none", letterSpacing: 0 }}>
            <span>Không tải được quyền truy cập: {loiQuyen}</span>
            <button type="button" className="btn btn--ghost" onClick={() => reloadAccess()}>
              Thử lại
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className="shell__center">
        <EmptyState trangThai="dang-tai" />
      </div>
    );
  }

  const baseId = activeId.split(":")[0];
  // Màn TỒN KHO của từng kho là VIỆC CỦA KHO, không phải của người đề nghị: ông sản xuất chỉ có
  // `kho:read` để đi xin vật tư thì KHÔNG được nhìn tồn/lô. Từ 05/10/2026 MỖI KHO một dòng quyền
  // `ton_kho_<id>` (chủ chốt: "làm kho giống tổ đi, mỗi kho một dòng") — trước đó một dòng
  // `ton_kho` chung mở cùng lúc mọi kho.
  // "kho-item:<id>" = màn Tồn kho của 1 kho — gác Xem ở dòng của ĐÚNG kho đó.
  const isKhoView = baseId === "kho-item";
  const moduleKeys =
    MODULES_BY_NAV_ID[baseId] ??
    // "thuc-hien-sx" là node lá ĐỘNG — không nằm trong NAV tĩnh của Sidebar nên MODULES_BY_NAV_ID
    // không có, phải khai tay ở đây.
    (baseId === "thuc-hien-sx"
      ? khoaBanTo(readable)
      : isKhoView ? [khoaTonKho(Number(activeId.split(":")[1]))] : undefined);
  const allowed =
    AUTHENTICATED_NAV_IDS.has(baseId) ||
    // KHÔNG mục nào còn phải lọc thêm sau `readable` nữa: "Báo cáo kho" (mg `0329`) và màn Tồn
    // kho của từng kho (mg `0334`) đều đã có khoá riêng. Trước đây cả hai gắn khoá `kho` rồi chặn
    // thêm bằng ô chi tiết `close_book` / `view_stock` — đúng chỗ làm ra những MÀN không có dòng
    // nào của riêng mình trong ma trận phân quyền.
    (moduleKeys != null && moduleKeys.some((moduleKey) => readable.has(moduleKey)));

  const itemChildren: Record<string, { id: string; label: string }[]> = {};
  // Kho đã khai báo → item ĐỘNG dưới SECTION "Kho hàng" (id section = "kho-hang"). Bấm 1 kho → màn tạm.
  // Mỗi mục mang khoá dòng của chính kho đó (`ton_kho_<id>`) — Sidebar lọc theo `readable` nên kho
  // nào chưa được bật Xem thì mục đó không hiện.
  const dynamicItems: Record<string, NavItem[]> = {};
  if (khoList.length) {
    dynamicItems["kho-hang"] = khoList.map((w): NavItem => ({
      id: `kho-item:${w.id}`, label: w.ten, icon: "warehouse", module: khoaTonKho(w.id),
    }));
  }
  // (Mục "KCS" nay là mục TĨNH cuối khối Sản xuất, khoá `kcs` — 09/10/2026, thay khoá giả theo
  // phòng ban "Tổ KCS" từng tiêm động vào đây.)
  const sanXuatDong: NavItem[] = [];
  // Tổ đã khai báo → node lá ĐỘNG dưới SECTION "Tổ sản xuất" (id section = "to-san-xuat", khối
  // tách riêng 24/09/2026 — trước đó đổ chung vào khối "Sản xuất"). Bấm 1 tổ → mở
  // bàn "Thực hiện sản xuất" lọc theo tổ. teamList chỉ có dữ liệu khi có Xem ở một dòng quyền theo
  // tổ, nên thiếu quyền thì không đổ node nào. Máy chủ trả theo thứ tự cây kèm `cap` — thụt lề tính
  // từ nút NÔNG nhất người này thấy, để ai chỉ thấy vài tổ lá thì menu vẫn thẳng hàng.
  if (teamList.length) {
    const cacKhoaTo = khoaBanTo(readable);
    const capGoc = Math.min(...teamList.map((t) => t.cap ?? 0));
    // Danh sách về PHẲNG nhưng theo thứ tự cây: nút cha của một hàng là hàng NÔNG hơn gần nhất
    // phía trên. Giữ một chồng để suy ra `parentId` → Sidebar gập được cả nhánh (11 tổ + 5 nhóm in
    // đẩy menu dài quá màn hình).
    const nganh: { cap: number; id: string }[] = [];
    for (const t of teamList) {
      const cap = (t.cap ?? 0) - capGoc;
      while (nganh.length && nganh[nganh.length - 1].cap >= cap) nganh.pop();
      const id = `thuc-hien-sx:${t.id}`;
      sanXuatDong.push({
        id, label: t.ten, icon: "users", module: "to_sx",
        modules: cacKhoaTo, indent: cap,
        parentId: nganh.length ? nganh[nganh.length - 1].id : undefined,
      });
      nganh.push({ cap, id });
    }
  }
  if (sanXuatDong.length) dynamicItems["to-san-xuat"] = sanXuatDong;
  // Mục "Kho" chỉ cần `kho:read`; tab "Phiếu từ đề nghị" (cần create/view_stock) tự ẩn trong KhoPage.
  const hiddenIds = new Set<string>();
  // Điện thoại: bảng tra mục menu cho thanh dưới + chuông việc chờ + tên màn trên thanh trên.
  const mucDT = laDT && readable ? bangMuc(dynamicItems, itemChildren, readable, hiddenIds) : null;


  function renderContent() {
    if (!allowed) {
      // Tài khoản chưa gán vai thì không có mục nào để về — nói đúng lý do, không chỉ nút dẫn về
      // chính trang 403 (#75). Nút "Về Hồ sơ của tôi" chỉ khi người đó vào được Hồ sơ và đang ở chỗ khác.
      const chuaCoVai = readable != null && readable.size === 0;
      const veHoSo = !!readable?.has("self_service") && baseId !== "ho-so-cua-toi";
      return (
        <main className="shell__forbidden">
          <div className="banner banner--error" role="alert">
            <span>
              {chuaCoVai
                ? "Tài khoản của bạn chưa được gán vai trò nào nên chưa mở được mục nào. Nhờ quản trị viên gán vai rồi tải lại trang."
                : "Bạn không có quyền truy cập mục này (403)."}
            </span>
            {veHoSo && (
              <button
                type="button"
                className="btn btn--ghost"
                style={{ padding: "2px 10px" }}
                onClick={() => setActiveId("ho-so-cua-toi")}
              >
                Về Hồ sơ của tôi
              </button>
            )}
          </div>
        </main>
      );
    }
    // Khai báo kho: màn CRUD generic + onMutate → refetch item động ngay sau khi tạo/sửa/xoá.
    if (baseId === "khai-bao-kho") {
      return <RebuildCatalogPage key="khai-bao-kho" config={REBUILD_CONFIGS["khai-bao-kho"]} onMutate={reloadKho} />;
    }
    // Kho — MỘT module, chia tab (Đề nghị · Hộp yêu cầu) × (Nhập · Xuất). Tick nhóm `kho` của kênh
    // SSE chung: mọi sự kiện kho đều nhích tick nên bảng tự tươi, không mở EventSource riêng.
    if (baseId === "kho-main") {
      return (
        <KhoPage
          eventTick={tickCua("kho")}
          nhapSeed={navParams?.khoNhapSeed}
          counts={khoCounts}
          onSeen={reloadBadges}
          openRequest={navParams?.khoOpenRequest}
        />
      );
    }
    // Báo cáo kho (kế toán): sổ nhập-xuất + khóa kỳ + export MISA. Gác bằng khoá riêng
    // `bao_cao_kho` ở `allowed`; khoá kỳ bên trong còn hỏi thêm ô chi tiết `close_book` ở máy chủ.
    if (baseId === "kho-baocao") {
      return <KhoBaoCaoPage token={token ?? ""} />;
    }
    // Màn TỒN KHO của 1 kho đã khai báo (bấm item "kho-item:<id>" dưới section "Kho hàng").
    if (baseId === "kho-item") {
      const id = Number(activeId.split(":")[1]);
      const w = khoList.find((x) => x.id === id);
      return (
        <KhoTonKhoPage
          key={`kho-ton-${id}`}
          khoId={id}
          ten={w?.ten ?? "Kho"}
          ma={w?.ma}
          token={token ?? ""}
          navigate={navigate}
          openMatHangKey={navParams?.openMatHangKey ?? null}
          khoOptions={khoList}
        />
      );
    }
    // Bàn "Thực hiện sản xuất" của 1 tổ (bấm node lá "thuc-hien-sx:<teamId>" dưới section Sản xuất).
    // `eventTick` = tick nhóm sản xuất + kho → bàn đang mở tự refetch khi bàn tổ / kho cấp vật tư đổi.
    if (baseId === "thuc-hien-sx") {
      const teamId = Number(activeId.split(":")[1]);
      // Tổ cha: effect phía trên đang chuyển sang tổ lá — đừng nạp bàn gộp trong lúc chờ.
      if (toLaDauTien(teamList, teamId) != null) return null;
      const t = teamList.find((x) => x.id === teamId);
      return (
        <ThucHienSxPage
          key={`thsx-${teamId}`}
          teamId={teamId}
          tenTo={t?.ten}
          laTho={t?.la_tho ?? false}
          coBaoDungMay={t?.quyen?.confirm_output === "all"
            || (t?.quyen?.read != null && Boolean(caps.get("ky_thuat_may")?.can_request))}
          eventTick={tickCua("san_xuat", "kho")}
          vatTuDeNghiDem={vatTuDeNghiDem}
          dinhKemDem={lsxDinhKemDem}
          onXemCongViec={datCvDangMo}
          onBadgeStale={reloadTeams}
        />
      );
    }
    // Màn KCS theo lệnh — một màn cho mọi người KCS, không theo tổ.
    if (baseId === "kcs") {
      return (
        <KcsTheoLenhPage key="kcs" eventTick={tickCua("san_xuat", "kho")} dinhKemDem={lsxDinhKemDem}
          onBadgeStale={reloadTeams} navigate={navigate} />
      );
    }
    // Id cũ "quy-doi" (màn cặp riêng, đã gộp vào drawer đơn vị) → về đúng màn Đơn vị.
    if (baseId === "quy-doi") {
      return <RebuildCatalogPage key="don-vi" config={REBUILD_CONFIGS["don-vi"]} />;
    }
    // Tiêu chí KCS KHÔNG dùng nền danh mục phẳng: khai theo cây Giai đoạn → Công đoạn → hạng
    // mục kiểm (08/09/2026, `docs/design-kcs-theo-cong-doan.md` mục 5).
    if (baseId === "kcs-tieu-chi") {
      return <KcsTieuChiPage key="kcs-tieu-chi" />;
    }
    // Danh mục rebuild (Máy · Vật liệu Kho · Công đoạn · Loại SP · Giấy) — 1 trang generic theo config.
    if (REBUILD_CONFIGS[baseId]) {
      return <RebuildCatalogPage key={baseId} config={REBUILD_CONFIGS[baseId]} navigate={navigate} />;
    }
    switch (baseId) {
      case "quy-trinh-kinh-doanh":
        return (
          <QuyTrinhKinhDoanhPage
            navigate={navigate}
            // Cùng cổng `allowed` ở trên: theo ô quyền của mục menu.
            moDuoc={(id) => (MODULES_BY_NAV_ID[id] ?? []).some((m) => readable?.has(m) ?? false)}
          />
        );
      case "phong-ban":
        return <DepartmentsPage navigate={navigate} />;
      case "nhan-su":
        return <NhanSuPage navigate={navigate} />;
      case "ho-so-cua-toi":
        return <HoSoCuaToiPage navigate={navigate} eventTick={tickCua("nhan_su")} />;
      case "noi-quy":
        return <NoiQuyPage />;
      case "cham-cong":
        // `eventTick` nhảy theo sự kiện nhóm nhân sự → tab phiếu đi muộn/về sớm đang mở tự tải lại ngay
        // khi tổ trưởng duyệt/từ chối (không chỉ nhảy badge).
        return (
          <ChamCongPage
            navigate={navigate}
            focusEmployeeId={navParams?.focusEmployeeId}
            openTab={navParams?.chamCongTab}
            onChanged={reloadBadges}
            eventTick={tickCua("nhan_su")}
          />
        );
      case "nghi-phep":
        return <NghiPhepPage onChanged={reloadBadges} focusEmployeeId={navParams?.focusEmployeeId} eventTick={tickCua("nhan_su")} />;
      case "tang-ca":
        // `eventTick` nhảy theo sự kiện nhóm nhân sự → bảng phiếu đang mở tự tải lại ngay khi bên kia
        // duyệt/từ chối/gửi phiếu (không chỉ nhảy badge).
        return <TangCaPage onChanged={reloadBadges} eventTick={tickCua("nhan_su")} />;
      case "luong":
        return (
          <LuongPage
            navigate={navigate}
            focusEmployeeId={navParams?.focusEmployeeId}
            eventTick={tickCua("nhan_su")}
            openTab={navParams?.luongTab}
          />
        );
      case "khach-hang":
        return (
          <KhachHangPage navigate={navigate} onBadgeStale={reloadBadges} eventTick={tickCua("ban_hang")}
            openCustomerId={navParams?.openCustomerId ?? null} />
        );
      case "tinh-gia":
        return (
          <TinhGiaPage
            navigate={navigate}
            openPhieuId={navParams?.focusPhieuId}
            taoMoi={navParams?.taoPhieuTinhGia}
            eventTick={tickCua("danh_muc")}
          />
        );
      case "bao-gia":
        return (
          <BaoGiaPage
            openQuoteId={navParams?.openQuoteId ?? null}
            navigate={navigate}
            eventTick={tickCua("ban_hang")}
          />
        );
      case "don-hang-ban":
        // Drawer đơn bày tiến độ (sản xuất · kho · giao) và hoá đơn (kế toán) — hai tick riêng, thay cho
        // hai kênh SSE mà drawer từng tự mở (28/09/2026).
        return (
          <DonHangBanPage
            navigate={navigate}
            openOrderId={navParams?.openOrderId ?? null}
            openOrderChang={navParams?.openOrderChang ?? null}
            eventTick={tickCua("ban_hang", "san_xuat", "kho", "giao_hang")}
            keToanTick={tickCua("mua_ke_toan")}
          />
        );
      case "bao-cao-kinh-doanh":
        return <BaoCaoKinhDoanhPage />;
      case "giao-hang":
        // `eventTick` tăng mỗi sự kiện SSE ⇒ bảng chuyến tự tươi, không phải F5.
        return <GiaoHangPage eventTick={tickCua("giao_hang", "ban_hang")} />;
      case "ke-hoach-sx":
        return (
          <KeHoachSXPage
            navigate={navigate}
            openOrderId={navParams?.openSxOrderId ?? null}
            openLsxId={navParams?.openLsxId ?? null}
            eventTick={tickCua("san_xuat", "ban_hang", "khvt")}
            dinhKemDem={lsxDinhKemDem}
            onBadgeStale={reloadBadges}
          />
        );
      case "lenh-san-xuat":
        // Bàn TRA CỨU, chỉ đọc. `eventTick` nhích theo sự kiện nhóm sản xuất ⇒ bảng tự tươi khi tổ bấm
        // Bắt đầu/Kết thúc — màn tự GỘP 2 giây rồi mới gọi lại, và KHÔNG toast (bảng tra cứu
        // không phải chỗ báo tin). Hồ sơ một lệnh là LỚP PHỦ do chính màn này mở, không phải một
        // trang riêng — `navigate` chỉ để hồ sơ đi tiếp sang màn Đơn hàng bán khi cần lập yêu cầu
        // giao hàng.
        return (
          <LenhSanXuatPage
            eventTick={tickCua("san_xuat")}
            navigate={navigate}
            openHoSoId={navParams?.openHoSoLsxId ?? null}
            openHoSoPv={navParams?.openHoSoPv ?? null}
            openHoSoSeq={navParams?.navSeq ?? null}
          />
        );
      case "theo-doi-san-xuat":
        // Theo dõi THEO ĐƠN (12/10/2026), chỉ đọc. Ngăn một đơn do chính màn này mở; mã lệnh trong
        // ngăn điều hướng sang `lenh-san-xuat` (openHoSoLsxId) — màn không có deep-link riêng.
        return <TheoDoiSanXuatPage eventTick={tickCua("san_xuat")} navigate={navigate} />;
      case "ke-hoach-vat-tu":
        return (
          <KeHoachVatTuPage
            navigate={navigate}
            eventTick={tickCua("khvt", "san_xuat", "kho")}
            focusLsxMa={navParams?.focusLsxMa ?? null}
          />
        );
      // GIỮ NGUYÊN dù màn đang ẩn (`BAI_GHEP_ENABLED = false`): route này hiện không tới được —
      // mục menu bị ẩn nên `MODULES_BY_NAV_ID` không có id `bai-ghep-2` và cổng `allowed` chặn
      // trước khi tới đây. Bỏ `case` đi thì bật cờ lại phải sửa hai chỗ thay vì một.
      case "bai-ghep-2":
        return (
          <BaiGhep2Page
            navigate={navigate}
            eventTick={tickCua("san_xuat")}
            onBadgeStale={reloadBadges}
            openBaiGhepId={navParams?.openBaiGhepId ?? null}
            openSeq={navParams?.navSeq ?? null}
          />
        );
      case "xep-lich":
        return <XepLichPage eventTick={tickCua("san_xuat")} onBadgeStale={reloadBadges} navigate={navigate} />;
      case "sua-chua-may":
        // `eventTick` nhích theo sự kiện nhóm kỹ thuật ⇒ danh sách yêu cầu tự nạp lại khi có lời báo mới
        // hoặc khi người khác vừa tiếp nhận — không để hai người cùng lập phiếu cho một cái máy.
        return <SuaChuaMayPage eventTick={tickCua("ky_thuat")} onBadgeStale={reloadBadges} />;
      case "phieu-bao-tri":
        return <PhieuBaoTriPage />;
      case "yeu-cau-mua-hang":
        return (
          <DepartmentPurchaseRequestsPage
            navigate={navigate}
            eventTick={tickCua("mua_ke_toan")}
            focusRequestCode={navParams?.focusRequestCode ?? null}
            seedLines={navParams?.purchaseSeedLines ?? null}
            seedPurpose={navParams?.purchaseSeedPurpose ?? null}
            seedHeader={navParams?.purchaseSeedHeader ?? null}
            seedNguon={navParams?.purchaseSeedNguon ?? null}
          />
        );
      case "mua-hang":
        // `focusRequestCode` nối sang cả màn Mua hàng: từ 08/08/2026 màn này có hai tab con và
        // mở mặc định ở tab "Yêu cầu chờ xử lý". Màn nào bấm mã nhảy sang đây (mã `PMH-…` hay
        // `YCMH-…`) thì trang tự chọn đúng tab + đổ mã vào ô tìm — không có dòng này thì người
        // dùng rơi vào tab yêu cầu, không thấy phiếu, tưởng phiếu đã bị xoá.
        return (
          <PurchaseRequestsPage
            navigate={navigate}
            eventTick={tickCua("mua_ke_toan")}
            focusRequestCode={navParams?.focusRequestCode ?? null}
            lapDonTuYeuCau={navParams?.lapDonTuYeuCau ?? false}
            onDataRefreshed={markThuMuaNotificationsRead}
          />
        );
      case "nha-cung-cap":
        return <SuppliersPage eventTick={tickCua("mua_ke_toan")} openSupplierId={navParams?.openSupplierId ?? null} />;
      // Nhóm con "Kế toán thu mua" đã BỎ ngày 12/08/2026 — ba màn của nó nay đứng ngang hàng với
      // Phiếu thu / Công nợ phải thu. Không còn id cha nên cũng không cần nhánh rơi-vào-con-đầu.
      case "ke-toan-don-mua-hang":
        return (
          <AccountingPurchaseInboxPage
            navigate={navigate}
            eventTick={tickCua("mua_ke_toan")}
            focusRequestCode={navParams?.focusRequestCode ?? null}
            onDataRefreshed={markKeToanNotificationsRead}
          />
        );
      case "ke-toan-phieu-chi":
        return (
          <PaymentVouchersPage
            navigate={navigate}
            // `ban_hang`: huỷ đơn / huỷ hoá đơn đổi hàng "Chờ trả lại khách".
            eventTick={tickCua("mua_ke_toan", "ban_hang")}
            focusQuery={navParams?.focusVoucherQuery ?? null}
            focusChoChi={navParams?.focusChoChiCode ?? null}
          />
        );
      case "ke-toan-cong-no":
        return <AccountingPayablesPage navigate={navigate} eventTick={tickCua("mua_ke_toan")} />;
      case "ke-toan-cong-no-phai-thu":
        return (
          <AccountingReceivablesPage
            navigate={navigate}
            eventTick={tickCua("mua_ke_toan", "ban_hang")}
            focusCustomer={navParams?.focusReceivableCustomer ?? null}
          />
        );
      case "ke-toan-bao-cao":
        return <BaoCaoKeToanPage navigate={navigate} />;
      case "bao-cao-thu-chi":
        return <BaoCaoThuChiPage navigate={navigate} locMuc={navParams?.locMucThuChi ?? null} />;
      case "ke-toan-tai-khoan-ngan-hang":
        return <AccountingBankAccountsPage navigate={navigate} eventTick={tickCua("mua_ke_toan", "ban_hang")} />;
      case "tai-san":
        return <TaiSanPage />;
      case "ke-toan-phieu-thu":
        return (
          <PaymentReceiptsPage
            navigate={navigate}
            eventTick={tickCua("mua_ke_toan", "ban_hang")}
            focusQuery={navParams?.focusReceiptQuery ?? null}
          />
        );
      case "nhat-ky":
        return <ActivityLogPage navigate={navigate} eventTick={nhatKyTick} />;
      default:
        return <DashboardPage />;
    }
  }

  return (
    <PermissionsProvider caps={caps} onReload={taiLaiQuyenTuMan}>
      <div className={`shell${navOpen ? " is-nav-open" : ""}`}>
        {/* Màn che sau ngăn kéo — chỉ tồn tại khi ngăn kéo mở (màn hẹp). */}
        {navOpen && (
          <button
            type="button"
            className="shell__scrim"
            aria-label="Đóng menu điều hướng"
            onClick={() => setNavOpen(false)}
          />
        )}
        <Sidebar
          activeId={activeId}
          onSelect={(id) => navigate(id)}
          readable={readable}
          itemChildren={itemChildren}
          dynamicItems={dynamicItems}
          badges={badges}
          hiddenIds={hiddenIds}
          onClose={() => setNavOpen(false)}
        />
        <div className="shell__main">
          {/* Bong bóng rê chuột cho ô bảng bị cắt "…" / có title — một bản cho cả app. */}
          {/* Điện thoại không có chuột — chạm ô là mở dòng, bong bóng chỉ che thẻ. */}
          {!laDT && <GoiYBang />}
          <Topbar
            onOpenProfile={() => navigate("ho-so-cua-toi")}
            onToggleNav={() => setNavOpen((v) => !v)}
            navOpen={navOpen}
            tieuDe={mucDT?.get(activeId)?.label}
            chuong={
              mucDT && (
                <ChuongViec activeId={activeId} badges={badges} muc={mucDT} onSelect={(id) => navigate(id)} />
              )
            }
          />
          <div className="shell__content">
            {/* Mỗi màn là một chunk nạp khi mở lần đầu — chờ tải thì báo nhẹ, không trắng màn. */}
            <Suspense
              fallback={
                <div className="shell__center">
                  <EmptyState trangThai="dang-tai" />
                </div>
              }
            >
              {renderContent()}
            </Suspense>
          </div>
        </div>
        {/* Điện thoại (≤639px): thanh điều hướng dưới — máy lớn không vẽ phần tử này. */}
        {mucDT && (
          <MobileTabBar
            activeId={activeId}
            badges={badges}
            muc={mucDT ?? new Map()}
            menuOpen={navOpen}
            onSelect={(id, params) => navigate(id, params)}
            onMenu={() => setNavOpen((v) => !v)}
          />
        )}
        {/* Toast real-time luồng gửi duyệt — nổi góc trên-phải, tự tắt sau 6s. */}
        {toasts.length > 0 && (
          <div
            aria-live="polite"
            className="apx-toastwrap"
            style={{
              position: "fixed", top: 16, right: 16, zIndex: 9999,
              display: "flex", flexDirection: "column", gap: 8, maxWidth: 340,
            }}
          >
            {toasts.map((t) => (
              <div
                key={t.id}
                role="status"
                onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
                style={{
                  padding: "10px 14px", borderRadius: 10, cursor: "pointer",
                  color: "#fff", fontSize: 13, fontWeight: 600, lineHeight: 1.35,
                  boxShadow: "0 10px 28px rgba(0,0,0,.28)",
                  background:
                    t.tone === "ok" ? "#1f8a52" : t.tone === "warn" ? "#b4432b" : "#2b6cb0",
                }}
              >
                {t.text}
              </div>
            ))}
          </div>
        )}
      </div>
    </PermissionsProvider>
  );
}
