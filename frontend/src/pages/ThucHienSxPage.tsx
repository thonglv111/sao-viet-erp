// THỰC HIỆN SẢN XUẤT tại TỔ — "một bàn làm việc" (module `san_xuat`, pha đứng SAU "Xếp lịch").
//
// Controller bàn tổ: nhận `teamId`, giữ cửa sổ ngày (7/14/30 ngày) + việc + việc-đang-chọn + version
// lạc quan; gọi `api.sanXuat.*`; dựng top → subbar → grid (hàng chờ trái · lịch ngày giữa · drawer
// phải) → foot. Điều phối drawer + dialog lý do + toast. **KHÔNG kéo–thả** (tổ trưởng chỉ đọc lịch, ghi
// phân công / phiên chạy). Real-time qua `eventTick` (SSE mắc ở AppShell) → refetch tức thì.
//
// LÝ DO bắt buộc (bám luật BE): chỉ còn Tạm dừng cần `ly_do`. Lý do "số người khác kíp chuẩn" GỠ
// 18/09/2026 (mg `0321`) cùng kíp chuẩn của bước; sớm hay trễ so với giờ dự kiến KHÔNG hỏi lý do
// (gỡ 16/09/2026). Ghi hỏng: 403 → "ngoài phạm vi"; 400/khác → toast + refetch chi tiết.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays, ChevronLeft, ChevronRight, ChevronsRight, Clock, Inbox, Search, X,
} from "lucide-react";
import {
  ApiError, api,
  type SxWorkItem, type SxWorkItemChiTiet, type SxNhanVienChon, type SxLenhNhom,
  type SxHoTroUngVien,
  type SxSuCoIn, type SxChoXacNhan, type SxWorkItemsLocDem, type SxWorkItemsOut,
} from "../api/client";
import { kyThuatMay, type MayChon } from "../api/kyThuatMay";
import { useAuth } from "../auth/useAuth";
import { useDebounced } from "../utils/useDebounced";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { Icon } from "../components/Icons";
import { PhanTrangDayDu } from "../components/PhanTrangDayDu";
import { ChonCot, OTim, useCauHinhLuoi } from "../components/LuoiDs";
import "../components/empty-state.css";
import { BangLoi, EmptyState, ngayGio, thoiLuong } from "./keHoachSxShared";
import { useNapTenDonVi } from "./tenDonVi";
import { ngayToWall, wallMinutes } from "./gantt-time";
import { ThsxLichNgay, phutTrongCuaSo } from "./ThsxLichNgay";
import { XlKhoangNgay } from "./XlKhoangNgay";
import { CO_NHIN, NhanKhoang, khoangTheoCo, laCoNhin, soTuan, type CoNhin } from "./xlKhoang";
import { dauTuan, gioChu, soNgayGiua, themNgay } from "./xlShared";
import { COT_THSX, ThsxDanhSach } from "./ThsxDanhSach";
import { ChipKcs, ChipKhuon, ChipLoaiBuoc } from "../components/ChipBuoc";
import { ThsxTamDungHop } from "./thsx/ThsxTamDungHop";
import { ThsxDrawer, type ThsxDrawerTab } from "./ThsxDrawer";
import { type ThsxExec } from "./ThsxExecPanels";
import { ThsxChoNgoaiBan } from "./ThsxChoNgoaiBan";
import { ThsxTuyenChuGiai } from "./ThsxTuyenNho";
import { ThsxDemTrangThai } from "./thsx/ThsxDemTrangThai";
import { ThsxSapXepNut } from "./thsx/ThsxSapXep";
import {
  CHO_MOI_LOAI, LOC_MAN_BAN_TO_TRONG, MOC_BAN_TO, dieuKienBanTo, locBanToLenUrl,
  locBanToTuUrl, thamSoLocBanTo, type ThsxTrangThaiLoc,
} from "./loc-san-xuat/dieu-kien-ban-to";
import { ThanhLoc } from "./thanh-loc/ThanhLoc";
import { thamSoKy } from "./thanh-loc/ky-danh-sach";
import { useLocMan } from "./thanh-loc/useLocMan";
import { ChamCho, choNgoaiBan, choTheoViec, tabCho, tongCho, type SxChoCuaViec } from "./thsxChoXacNhan";
import { ThsxSanLuongTab } from "./ThsxSanLuongTab";
import {
  chonHinhBan, sxCoGio, sxDigest, sxNguonIcon, sxSerial,
  ThsxTrangThaiPill,
} from "./thsxShared";
import "./xep-lich-a.css";
import "./thuc-hien-sx.css";
import { laDienThoai } from "../utils/dienThoai";

// ============================ helper thuần ==================================
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// View Lịch theo khuôn bàn Xếp lịch (10/10/2026): ba cỡ nhìn Tuần / 2 tuần / Tháng, hoặc khoảng tự
// chọn ở bảng lịch; ‹ › dời đúng một khoảng. Cỡ nhìn nhớ theo máy người xem.
const CO_NHIN_KEY = "thsx.coNhin";
const KHAY_KEY = "thsx.hangChoMo";

function readCoNhin(): CoNhin {
  try {
    const s = localStorage.getItem(CO_NHIN_KEY);
    if (s === "tuan" || s === "hai_tuan" || s === "thang") return s;
    // Máy còn lưu nấc số ngày cũ (7/14/30) thì đổi sang cỡ nhìn gần nhất.
    const n = Number(localStorage.getItem("thsx.soNgay"));
    return n === 14 ? "hai_tuan" : n === 30 ? "thang" : "tuan";
  } catch {
    return "tuan";
  }
}
function laONhap(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
}

type LichLamViec = { ngayNghi: string[]; ngayDacBiet: NonNullable<SxWorkItemsOut["ngay_dac_biet"]>; cacCa: NonNullable<SxWorkItemsOut["cac_ca"]> };
const LICH_TRONG: LichLamViec = { ngayNghi: [], ngayDacBiet: [], cacCa: [] };
type TtLich = "running" | "paused" | "released" | "completed";

// Kiểu view bàn tổ: "danh_sach" (bảng tràn màn), "lich" (Gantt) hay "san_luong" (tab Sản lượng, spec
// 2026-09-14 §6). View "Thẻ" đã gỡ 14/09/2026 — máy nào còn lưu "the" thì rơi về mặc định Bảng.
type ThsxView = "danh_sach" | "lich" | "san_luong";
const VIEW_KEY = "thsx.view";

function readView(): ThsxView {
  const s = typeof localStorage !== "undefined" ? localStorage.getItem(VIEW_KEY) : null;
  return s === "lich" || s === "san_luong" ? s : "danh_sach";
}

// Dialog lý do: chỉ còn Tạm dừng (luôn hỏi).
type Reason = { kind: "tam_dung" };

// ============================ controller =====================================
export function ThucHienSxPage({
  teamId,
  tenTo,
  laTho = false,
  eventTick,
  vatTuDeNghiDem,
  dinhKemDem,
  onXemCongViec,
  onBadgeStale,
}: {
  teamId: number;
  tenTo?: string;
  /** Người đang xem vào tổ này ở mức "Của tôi" (cờ `la_tho` của `GET /teams`, máy chủ tính): danh
   *  sách chỉ có việc giao cho họ, nên khi trống phải nói đúng lý do đó. */
  laTho?: boolean;
  eventTick?: number;
  /** Số lần đề nghị cấp vật tư đổi, ĐẾM THEO công việc (SSE, mắc ở AppShell). CỐ TÌNH không đi qua
   *  `eventTick`: sự kiện này broadcast TOÀN HỆ, nếu bump tick chung thì mỗi lần bất kỳ tổ nào
   *  trong nhà máy gửi đề nghị là drawer của mọi người gọi lại API. Chỉ nạp lại khi số đếm CỦA
   *  RIÊNG việc đang mở tăng — một sự kiện, nhiều nhất MỘT lượt gọi lại. */
  vatTuDeNghiDem?: Record<number, number>;
  /** Bộ đếm SSE tệp đính kèm theo LỆNH — chuyển xuống thẻ "Tệp của lệnh" của drawer. */
  dinhKemDem?: Record<number, number>;
  /** Báo lên AppShell việc đang mở drawer, để nó khỏi bắn toast cho chính việc đó. */
  onXemCongViec?: (id: number | null) => void;
  onBadgeStale?: () => void;
}) {
  const { token } = useAuth();
  // Bàn tổ hiện TÊN đơn vị lấy từ danh mục ("tờ", "bản kẽm") chứ không hiện MÃ ("to", "kem") —
  // nạp một lần ở đây cho cả cây con (drawer · ghi sản lượng · KCS · kho) dùng `nhanDonVi`.
  useNapTenDonVi();

  // Bàn tổ có HAI hình dữ liệu (11/09/2026): `lenh` = một TRANG lệnh/bài ghép (view Danh
  // sách, máy chủ đã gom và cắt trang theo LỆNH); `items` = mảng bước phẳng (view Lịch/Gantt —
  // trục thời gian không có tầng lệnh). Đúng một hình được nạp mỗi lần, tuỳ `view`.
  const [items, setItems] = useState<SxWorkItem[] | null>(null);
  const [lenh, setLenh] = useState<SxLenhNhom[] | null>(null);
  const [trang, setTrang] = useState(1);
  // Lệnh / trang — đơn vị trang của bàn tổ là LỆNH, không phải bước. Máy chủ nhận tối đa 100.
  const [coTrang, setCoTrang] = useState(25);
  const [tongLenh, setTongLenh] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<SxNhanVienChon[]>([]);
  const [hoTroUngVien, setHoTroUngVien] = useState<SxHoTroUngVien[]>([]);
  // Ngày XƯỞNG máy chủ trả kèm danh sách người — ô chọn so đơn nghỉ phép với ngày này.
  const [ungVienHomNay, setUngVienHomNay] = useState<string | null>(null);
  // Nhịp nạp lại hai danh sách người. Tình trạng (đang chạy việc nào, chờ mấy việc) đổi theo việc
  // của TỔ KHÁC mà bàn này không nhận sự kiện, nên mỗi lần mở ô chọn là nạp lại cho tươi.
  const [ungVienTick, setUngVienTick] = useState(0);
  const lamMoiUngVien = useCallback(() => setUngVienTick((n) => n + 1), []);
  const [mayOptions, setMayOptions] = useState<MayChon[]>([]);

  // Việc chờ tổ bấm (§11.5) — bàn giao đến · lỗi KCS chưa xem (máy chủ lọc theo quyền). Không còn hộp đầu trang: thành chấm đỏ trên dòng công đoạn / đầu lệnh / tab ngăn.
  const [choXn, setChoXn] = useState<SxChoXacNhan | null>(null);
  // Thanh lọc của view Bảng (06/10/2026): kỳ theo ngày tổ nhận / ngày tạo lệnh / dự kiến bắt đầu +
  // 6 điều kiện (09/10); cách sắp riêng bên phải. Ghi URL `?man=thuc-hien-sx:<tổ>`, máy chủ lọc
  // trước khi cắt trang. "Việc chờ tổ bấm" dùng chung với nút chờ của view Lịch (nút bật = mọi loại).
  const [locMan, setLocMan] = useLocMan(`thuc-hien-sx:${teamId}`, LOC_MAN_BAN_TO_TRONG, locBanToTuUrl, locBanToLenUrl);
  const chiCho = locMan.loc.cho.length > 0;
  const setChiCho = (b: boolean) => setLocMan({ ...locMan, loc: { ...locMan.loc, cho: b ? [...CHO_MOI_LOAI] : [] } });
  const sapXep = locMan.sapXep;
  const khoaLoc = JSON.stringify({ ...thamSoKy(locMan.ky), ...thamSoLocBanTo(locMan.loc) });
  const coLoc = khoaLoc !== "{}";
  const [g5Tick, setG5Tick] = useState(0); // nhịp refetch riêng cho G5 sau mỗi lệnh ghi

  // ---- khoảng ngày của view Lịch (khuôn bàn Xếp lịch) ----
  const [[winTu, winDen], setKhoang] = useState<[string, string]>(() => khoangTheoCo(readCoNhin(), ymd(new Date())));
  const soNgay = soNgayGiua(winTu, winDen);
  const coNhin = laCoNhin(winTu, winDen);
  useEffect(() => {
    if (!coNhin) return;
    try { localStorage.setItem(CO_NHIN_KEY, coNhin); } catch { /* bộ nhớ trình duyệt bị chặn */ }
  }, [coNhin]);
  const [moKhoang, setMoKhoang] = useState(false);
  // Đổi cỡ nhìn neo vào HÔM NAY khi hôm nay đang trong khoảng xem — đang xem cả tháng 10 mà bấm Tuần
  // thì muốn tuần này, không phải tuần chứa ngày 1.
  const chonCo = (co: CoNhin) => {
    const nay = ymd(new Date());
    setKhoang(khoangTheoCo(co, nay >= winTu && nay <= winDen ? nay : winTu));
  };
  const luiTien = (huong: 1 | -1) => {
    if (coNhin === "thang") {
      const [y, m] = winTu.split("-").map(Number);
      setKhoang(khoangTheoCo("thang", ymd(new Date(y, m - 1 + huong, 1))));
      return;
    }
    setKhoang([themNgay(winTu, huong * soNgay), themNgay(winDen, huong * soNgay)]);
  };
  /** Đưa khoảng về chứa ngày `d`: giữ cỡ nhìn đang chọn; khoảng tự chọn thì giữ số ngày, bắt đầu
   *  từ thứ Hai của tuần chứa `d`. */
  const veNgay = useCallback((d: string) => {
    const co = laCoNhin(winTu, winDen);
    if (co) { setKhoang(khoangTheoCo(co, d)); return; }
    const [y, m, dd] = d.split("-").map(Number);
    const t2 = dauTuan(new Date(y, m - 1, dd));
    setKhoang([t2, themNgay(t2, soNgayGiua(winTu, winDen) - 1)]);
  }, [winTu, winDen]);
  const homNayStr = ymd(new Date());
  const coHomNay = homNayStr >= winTu && homNayStr <= winDen;
  // Khay Hàng chờ bên phải (như khay Chờ xếp lịch) — mặc định mở, nhớ theo máy.
  // Điện thoại: khay Hàng chờ là trang phủ kín màn (không phải cột bên) — luôn mở ra ĐÓNG, bấm nút mới
  // hiện; đóng/mở trên điện thoại cũng không ghi đè lựa chọn đã nhớ của máy lớn.
  const [khayMo, setKhayMo] = useState<boolean>(() => {
    if (laDienThoai()) return false;
    try { return localStorage.getItem(KHAY_KEY) !== "0" && localStorage.getItem("thsx.hangChoThu") !== "1"; } catch { return true; }
  });
  useEffect(() => {
    if (laDienThoai()) return;
    try { localStorage.setItem(KHAY_KEY, khayMo ? "1" : "0"); } catch { /* bỏ qua */ }
  }, [khayMo]);
  // Lọc nhanh theo trạng thái trên dòng tóm tắt (chỉ view Lịch, lọc trên máy như ô tìm).
  const [ttLich, setTtLich] = useState<TtLich | null>(null);
  const [lichLv, setLichLv] = useState<LichLamViec>(LICH_TRONG);
  const oTimLichRef = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<ThsxView>(readView);
  useEffect(() => { localStorage.setItem(VIEW_KEY, view); }, [view]);

  const [q, setQ] = useState("");
  const qd = useDebounced(q, 200);
  // Cột của lưới bước (view Bảng): ẩn / đổi chỗ nhớ theo máy người xem, dùng chung mọi lệnh.
  const luoi = useCauHinhLuoi("thsx-ds");
  const choMap = useMemo(() => choTheoViec(choXn), [choXn]);
  const soChoXn = tongCho(choXn);
  // Số đếm cạnh giá trị lọc — cùng tổ + kỳ + ô tìm, KHÔNG kèm điều kiện (đếm "chọn cái này thì còn
  // bao nhiêu"). Nạp lại theo SSE và khi đổi tổ/kỳ/ô tìm; đổi trang hay đổi điều kiện thì không.
  const [locDem, setLocDem] = useState<SxWorkItemsLocDem | null>(null);
  const dieuKienBan = useMemo(() => dieuKienBanTo(locDem), [locDem]);
  const ngoaiBan = useMemo(() => choNgoaiBan(choXn), [choXn]);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  // Tab mở sẵn của drawer + nhịp remount: công đoạn đang có việc chờ thì vào thẳng tab nơi bấm (Nhận /
  // KCS / Bàn giao), kể cả khi đúng việc đó đang mở sẵn ở tab khác.
  const [tabDau, setTabDau] = useState<ThsxDrawerTab | undefined>(undefined);
  const [moLan, setMoLan] = useState(0);
  const [chiTiet, setChiTiet] = useState<SxWorkItemChiTiet | null>(null);
  const [ctLoading, setCtLoading] = useState(false);

  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [reason, setReason] = useState<Reason | null>(null);

  // ---- nạp dữ liệu ----
  // Từ khoá chỉ gửi máy chủ ở view Bảng. View Lịch lọc trên máy nên gõ tìm KHÔNG được nạp lại:
  // trước đây mỗi nhịp debounce bắn thêm một GET y hệt cửa sổ đang có (đo 15/09/2026).
  const timMayChu = view === "danh_sach" ? qd.trim() : "";
  // Số thứ tự lượt nạp: lượt CŨ về muộn (mạng chập, sự kiện dồn) thì bỏ, không đè lượt mới.
  const luotItems = useRef(0);
  const loadItems = useCallback(() => {
    // Tab Sản lượng tự nạp dữ liệu riêng — khỏi kéo trang lệnh về cho một bảng không hiện.
    if (!token || view === "san_luong") return;
    const luot = ++luotItems.current;
    setErr(null);
    const phang = view === "lich";
    api.sanXuat.workItems(token, {
      teamId,
      nhom: phang ? "phang" : "lenh",
      // Tìm kiếm lọc Ở MÁY CHỦ, trước khi cắt trang — lọc bằng JS sau khi trang về thì ô tìm
      // kiếm chỉ soi được đúng 20 lệnh đang hiện. Chế độ phẳng kéo trọn bàn nên màn tự lọc.
      // View Bảng gửi loại việc chờ trong `loc` (`cho_loai`); view Lịch chỉ có nút bật/tắt.
      ...(phang ? { tuNgay: winTu, denNgay: winDen, choXacNhan: chiCho || undefined }
        : {
          tim: timMayChu || undefined, trang, coTrang, loc: JSON.parse(khoaLoc),
          sapXep: sapXep === "moi_nhan" ? undefined : sapXep,
        }),
    })
      .then((r) => {
        if (luot !== luotItems.current) return;
        // Hình nào là do CỜ `nhom` của máy chủ quyết, không do "có mảng lệnh hay không" —
        // xem `chonHinhBan`.
        const h = chonHinhBan(r);
        if (phang) setLichLv({ ngayNghi: r.ngay_nghi ?? [], ngayDacBiet: r.ngay_dac_biet ?? [], cacCa: r.cac_ca ?? [] });
        setItems(h.cong_viec);
        setLenh(h.lenh);
        setTongLenh(h.tongLenh);
        setErr(null);
      })
      .catch((e: unknown) => {
        if (luot !== luotItems.current) return;
        setErr(e instanceof ApiError
          ? (e.isForbidden ? "Tổ này ngoài phạm vi của bạn." : e.message)
          : String(e));
      });
  }, [token, teamId, view, timMayChu, trang, coTrang, winTu, winDen, chiCho, khoaLoc, sapXep]);

  // SSE bump (`eventTick`) nạp lại nhưng GIỮ NGUYÊN `trang` — nhảy về trang 1 giữa lúc tổ đang
  // thao tác ở trang 3 là cướp chỗ đứng của người ta.
  useEffect(() => { loadItems(); }, [loadItems, eventTick]);
  // Đổi tổ / đổi từ khoá / đổi chế độ lọc ⇒ trang cũ không còn nghĩa, về trang 1.
  // Ô "chờ xác nhận" theo từng bàn: khoá URL/bộ nhớ của thanh lọc mang mã tổ, đổi tổ là bàn khác.
  useEffect(() => { setTrang(1); }, [teamId, qd, chiCho, khoaLoc, sapXep]);

  const khoaKy = JSON.stringify(thamSoKy(locMan.ky));
  useEffect(() => {
    if (!token || view !== "danh_sach") return;
    let alive = true;
    api.sanXuat.workItemsLocDem(token, { teamId, tim: timMayChu || undefined, loc: JSON.parse(khoaKy) })
      .then((r) => { if (alive) setLocDem(r); })
      .catch(() => { if (alive) setLocDem(null); });
    return () => { alive = false; };
  }, [token, teamId, view, timMayChu, khoaKy, eventTick, g5Tick]);

  // Tổ THẬT của việc đang mở: bàn nút cha gộp việc của nhiều tổ con, nên danh chọn người và xác nhận
  // nhận vật tư đi theo tổ của việc; chưa mở việc nào thì dùng nút đang xem.
  const toCuaViec = chiTiet?.cong_viec.department_id ?? teamId;

  // Ứng viên "Giao người" — endpoint riêng module (KHÔNG dùng api.employees vì gác quyền nhan_su).
  useEffect(() => {
    if (!token) return;
    api.sanXuat.nhanVienChon(token, toCuaViec)
      .then((r) => { setCandidates(r.nhan_vien); setUngVienHomNay(r.hom_nay); })
      .catch(() => setCandidates([]));
  }, [token, toCuaViec, ungVienTick]);

  // Ứng viên HỖ TRỢ CHÉO (§9) — thợ tổ SX khác đang làm; đổi tổ → dọn cache lý do (danh mục chung, giữ được).
  useEffect(() => {
    if (!token) return;
    api.sanXuat.hoTroUngVien(token, toCuaViec)
      .then((r) => setHoTroUngVien(r.nhan_vien))
      .catch(() => setHoTroUngVien([]));
  }, [token, toCuaViec, ungVienTick]);

  // Máy chọn được cho "Đổi máy" §7.2 — endpoint hẹp `may-chon` (KHÔNG dùng `mayThietBi.list`: đòi
  // quyền `dm_thiet_bi` mà thợ đứng máy không có). Danh mục máy CHUNG toàn hệ thống, không theo tổ.
  useEffect(() => {
    if (!token) return;
    kyThuatMay.mayChon(token)
      .then(setMayOptions)
      .catch(() => setMayOptions([]));
  }, [token]);

  // Đổi tổ → dọn lựa chọn.
  useEffect(() => { setSelectedId(null); setChiTiet(null); }, [teamId]);

  // ---- chi tiết việc đang chọn (drawer) ----
  // Cùng khuôn số thứ tự với `loadItems`: đổi việc nhanh / sự kiện dồn ⇒ chỉ lượt MỚI NHẤT được ghi.
  const luotCt = useRef(0);
  const loadChiTiet = useCallback((id: number | null) => {
    const luot = ++luotCt.current;
    if (!token || id == null) { setChiTiet(null); setCtLoading(false); return Promise.resolve(); }
    setCtLoading(true);
    return api.sanXuat.chiTiet(token, id)
      .then((r) => { if (luot === luotCt.current) setChiTiet(r); })
      .catch(() => { if (luot === luotCt.current) setChiTiet(null); })
      .finally(() => { if (luot === luotCt.current) setCtLoading(false); });
  }, [token]);

  // `mutate` đang chờ máy chủ lưu (từ lúc gửi tới lúc bắt đầu nạp lại chi tiết).
  const dangGhi = useRef(false);
  useEffect(() => { void loadChiTiet(selectedId); }, [loadChiTiet, selectedId]);
  // Sự kiện SX (SSE) → nạp lại việc đang mở. Đang có lượt ghi của chính mình thì BỎ: `mutate` nạp
  // lại ngay sau khi lưu xong, lượt đó bắt đầu sau mọi sự kiện về trước nó nên đã phủ luôn. Không
  // bỏ thì SSE của chính cú bấm (về TRƯỚC phản hồi POST) đẻ một GET song song — đo 16/09/2026 hai
  // GET chồng nhau kéo mỗi cái từ ~330 ms lên ~570 ms.
  const tickDaNap = useRef(eventTick);
  useEffect(() => {
    if (tickDaNap.current === eventTick) return;
    tickDaNap.current = eventTick;
    if (dangGhi.current) return;
    void loadChiTiet(selectedId);
  }, [eventTick, loadChiTiet, selectedId]);

  // Đề nghị vật tư đổi (SSE): CHỈ nạp lại khi số đếm CỦA RIÊNG việc đang mở tăng. So theo cặp
  // (việc, số đếm) nên đổi việc KHÔNG kéo theo một lượt gọi thừa — effect ngay trên vừa nạp rồi.
  const vtDaXem = useRef<{ cv: number | null; dem: number }>({ cv: null, dem: 0 });
  // Mốc thao tác ghi GẦN NHẤT của chính người này (`mutate` đặt HAI lần: trước khi gọi API và sau
  // khi nạp lại xong) — để tín hiệu SSE vọng về từ chính cú bấm đó không bắt nạp lần hai.
  const vuaTuNap = useRef(0);
  const vtDem = selectedId != null ? (vatTuDeNghiDem?.[selectedId] ?? 0) : 0;
  useEffect(() => {
    const truoc = vtDaXem.current;
    if (selectedId == null || truoc.cv !== selectedId || vtDem === truoc.dem) {
      vtDaXem.current = { cv: selectedId, dem: vtDem };
      return;
    }
    const nap = () => {
      vtDaXem.current = { cv: selectedId, dem: vtDem };
      void loadChiTiet(selectedId);
    };
    // Người VỪA bấm đã được `mutate` nạp lại xong, rồi sự kiện SSE của chính họ vọng về ngay sau
    // đó: nạp ngay là một lượt gọi API thừa cho đúng dữ liệu vừa lấy.
    const con = 2000 - (Date.now() - vuaTuNap.current);
    if (con <= 0) { nap(); return; }
    // …nhưng KHÔNG được vứt sự kiện rơi vào cửa đó. Cửa mở vì thao tác của CHÍNH mình, mà sự kiện
    // rơi vào có thể là của tổ trưởng khác — bỏ qua rồi đánh dấu "đã xem" là drawer đứng số cũ vô
    // thời hạn, không toast (AppShell im vì đúng việc đang mở) và không tự sửa theo thời gian.
    // Nên: hẹn ĐÚNG phần còn lại của cửa rồi nạp một lượt. `vtDaXem` chỉ ghi khi thật sự nạp, nên
    // nếu effect chạy lại giữa chừng thì sự kiện vẫn còn nguyên là "chưa xem". Một hẹn duy nhất —
    // không vòng lặp thăm dò, và vẫn đúng "một sự kiện nhiều nhất một lượt gọi API".
    const h = setTimeout(nap, con);
    return () => clearTimeout(h);
  }, [vtDem, selectedId, loadChiTiet]);

  // Cho AppShell biết drawer đang mở việc nào — nó dùng để KHÔNG bắn toast cho chính việc đó.
  useEffect(() => {
    onXemCongViec?.(selectedId);
    return () => onXemCongViec?.(null);
  }, [onXemCongViec, selectedId]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  /* Khối "thưởng/phạt tổ trưởng" GỠ 11/09/2026 (mg `0297`) — sản xuất thôi giữ tiền. */

  // Hộp thư LỖI KCS đã GỠ khỏi màn production (Task 9 §6.4, mg 0250 kiêm nhiệm) — luồng phản hồi
  // trách nhiệm cũ (pending/accepted/rejected) không còn hiện ở UI mới; hồ sơ cũ vẫn đọc được qua
  // drawer lịch sử nếu cần, chỉ KHÔNG polling/hiện thanh cảnh báo ở bàn tổ thường nữa.

  // Hộp thư KHO nhập thành phẩm ĐÃ GỠ 17/09/2026: KCS gửi thành phẩm thành yêu cầu NHẬP thật, kho
  // nhận ở Hộp yêu cầu của module Kho (design nhập kho thành phẩm qua Yêu cầu nhập xuất).

  // Việc chờ tổ bấm — nạp lại theo SSE (bàn giao/hỗ trợ đổi ở tổ kia) và sau mỗi lệnh ghi (kể cả ghi
  // trong ngăn chi tiết: xác nhận nhận hàng xong thì chấm đỏ phải tắt ngay, không chờ SSE).
  const [choTick, setChoTick] = useState(0);
  useEffect(() => {
    if (!token) { setChoXn(null); return; }
    let alive = true;
    api.sanXuat.choXacNhan(token, teamId)
      .then((r) => { if (alive) setChoXn(r); })
      .catch(() => { if (alive) setChoXn(null); });
    return () => { alive = false; };
  }, [token, teamId, eventTick, g5Tick, choTick]);
  // View Lịch: hết việc chờ thì nút "chờ xác nhận" tự tắt — để bật mà lưới trống trơn thì tổ tưởng
  // mất lệnh. View Bảng KHÔNG tự tắt: "Việc chờ tổ bấm" là điều kiện người dùng chọn trong menu Lọc
  // (kể cả giá trị đang đếm 0), có khối bỏ lọc và dòng báo trống riêng — tự xoá là nuốt cú bấm.
  useEffect(() => {
    if (view === "lich" && chiCho && choXn && soChoXn === 0) setChiCho(false);
  }, [view, chiCho, choXn, soChoXn]);

  // ---- lọc + gom nhóm cột trái / cluster timeline ----
  const winStartW = useMemo(() => ngayToWall(winTu), [winTu]);
  const winEndW = useMemo(() => ngayToWall(winDen) + 1440, [winDen]);

  const overlaps = useCallback((w: SxWorkItem): boolean => {
    if (!sxCoGio(w)) return false;
    const s = wallMinutes(w.du_kien_bat_dau as string);
    const e = wallMinutes(w.du_kien_ket_thuc as string);
    if (!Number.isFinite(s) || !Number.isFinite(e)) return false;
    return s < winEndW && e > winStartW;
  }, [winStartW, winEndW]);

  const match = useCallback((w: SxWorkItem): boolean => {
    const kw = qd.trim().toLowerCase();
    if (!kw) return true;
    return [w.nguon_ma, w.ten_cong_doan, w.may, w.nguon_ten, w.khach_hang]
      .some((s) => (s || "").toLowerCase().includes(kw));
  }, [qd]);

  const startW = (w: SxWorkItem) => wallMinutes(w.du_kien_bat_dau as string);
  const groups = useMemo(() => {
    const filtered = (items ?? []).filter((w) => match(w) && (ttLich === null || w.trang_thai === ttLich));
    const timed = filtered.filter(overlaps).sort((a, b) => startW(a) - startW(b));
    const outWin = filtered.filter((w) => sxCoGio(w) && !overlaps(w)).sort((a, b) => startW(a) - startW(b));
    const untimed = filtered.filter((w) => !sxCoGio(w));
    return { tong: filtered.length, timed, outWin, untimed };
  }, [items, match, overlaps, ttLich]);

  // Hàng chờ của view Lịch = việc KHÔNG vẽ được lên lưới đang xem (chưa định giờ / ngoài cửa sổ);
  // việc trong cửa sổ đã là một dòng trên lưới, lặp lại ở cột trái chỉ là nhiễu.
  const soCho = groups.untimed.length + groups.outWin.length;
  // Băng KPI đọc từ hình đang nạp: chế độ lệnh cộng `digest` của TRANG hiện tại (mỗi lệnh đã có
  // sẵn bốn con số từ máy chủ), chế độ phẳng đếm thẳng trên mảng bước.
  const digest = useMemo(() => {
    if (lenh == null) return sxDigest(items ?? []);
    const d = { tong: 0, released: 0, running: 0, paused: 0, completed: 0 };
    for (const l of lenh) {
      d.tong += l.so_viec;
      d.released += l.digest.released;
      d.running += l.digest.running;
      d.paused += l.digest.paused;
      d.completed += l.digest.completed;
    }
    return d;
  }, [lenh, items]);

  // Dòng tóm tắt của view Lịch — cả tổ trong khoảng (không theo ô tìm / lọc nhanh), như "máy chạy" của
  // bàn Xếp lịch. Nhích theo phút cho phiên đang chạy.
  const [nhipPhut, setNhipPhut] = useState(() => Date.now());
  useEffect(() => {
    if (view !== "lich") return;
    const h = window.setInterval(() => setNhipPhut(Date.now()), 60_000);
    return () => window.clearInterval(h);
  }, [view]);
  const phutLich = useMemo(() => phutTrongCuaSo(items ?? [], winTu, soNgay, nhipPhut), [items, winTu, soNgay, nhipPhut]);

  // Phím "/" vào ô tìm của view Lịch (như bàn Xếp lịch).
  useEffect(() => {
    if (view !== "lich") return;
    const phim = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || laONhap(e.target) || document.querySelector(".cdlg-overlay, .kt-man")) return;
      e.preventDefault();
      oTimLichRef.current?.focus();
    };
    document.addEventListener("keydown", phim);
    return () => document.removeEventListener("keydown", phim);
  }, [view]);

  // Hàng chip trạng thái: số của `loc-dem` (chưa về thì tạm đếm trên trang đang xem).
  const demTT = useMemo(() => {
    const tt = locDem?.trang_thai;
    const d = tt ? { released: tt.released ?? 0, running: tt.running ?? 0, paused: tt.paused ?? 0, completed: tt.completed ?? 0 }
      : { released: digest.released, running: digest.running, paused: digest.paused, completed: digest.completed };
    return { ...d, tong: d.released + d.running + d.paused + d.completed };
  }, [locDem, digest]);
  const datTrangThai = (trangThai: ThsxTrangThaiLoc[]) => setLocMan({ ...locMan, loc: { ...locMan.loc, trangThai } });

  // ---- chọn việc: mở drawer + (nếu ngoài cửa sổ) dời cửa sổ tới tuần của việc ----
  const pickViec = useCallback((w: SxWorkItem) => {
    if (sxCoGio(w) && !overlaps(w)) veNgay((w.du_kien_bat_dau as string).slice(0, 10));
    setTabDau(tabCho(choMap.get(w.id)));
    setSelectedId(w.id);
  }, [overlaps, choMap, veNgay]);
  const closePanel = useCallback(() => setSelectedId(null), []);

  // ---- ghi (khoá lạc quan) ----
  const handleErr = useCallback((e: unknown) => {
    if (e instanceof ApiError) {
      if (e.isForbidden) { setToast("Ngoài phạm vi — bạn không thao tác được việc này."); return; }
      setToast(e.message || "Không lưu được — đã tải lại bản mới.");
      void loadChiTiet(selectedId);
      return;
    }
    setToast("Lỗi mạng — thử lại.");
  }, [loadChiTiet, selectedId]);

  const mutate = useCallback(async <T,>(run: () => Promise<T>, ok: string): Promise<T | null> => {
    if (!token || selectedId == null) return null;
    setBusy(true);
    // Mốc đặt TRƯỚC cả `run()`: BE gọi `hub.broadcast(...)` TRƯỚC khi `return`, nên gói SSE của
    // chính cú bấm này có thể tới trình duyệt SỚM HƠN lúc `run()` resolve. Mốc đặt sau `run()` là
    // đã muộn — tín hiệu cần chặn đã đi qua cửa rồi.
    vuaTuNap.current = Date.now();
    dangGhi.current = true;
    let r: T;
    try {
      r = await run();
    } catch (e) {
      dangGhi.current = false;
      handleErr(e);
      setBusy(false);
      return null;
    }
    setReason(null);
    setToast(ok);
    // Trả kết quả NGAY khi máy chủ đã lưu để hộp nhập (Ghi mẻ, Đề xuất bàn giao…) đóng liền. Trước
    // đây hộp đứng chờ nạp lại cả chi tiết việc: đo 16/09/2026 lưu mất 87 ms mà hộp 688 ms mới
    // đóng. `busy` cũng NHẢ NGAY (28/09/2026): trước đây giữ tới khi nạp xong, một lượt nạp treo
    // là khoá mọi nút của drawer. Bấm tiếp trên số cũ thì khoá lạc quan (`expected_version`) ở
    // máy chủ đã chặn và `handleErr` nạp lại bản mới.
    const nap = loadChiTiet(selectedId);
    dangGhi.current = false;
    setBusy(false);
    void nap.finally(() => {
      // Đặt LẠI sau khi nạp xong: mốc đầu phủ khoảng sự kiện về SỚM, mốc này phủ khoảng nó về
      // MUỘN hơn lượt nạp. Cùng cửa 2 giây, không đẻ cơ chế mới.
      vuaTuNap.current = Date.now();
      loadItems();
      setChoTick((t) => t + 1);
      onBadgeStale?.();
    });
    return r;
  }, [token, selectedId, loadChiTiet, loadItems, onBadgeStale, handleErr]);

  // KCS báo lỗi về tổ — một chiều, không Nhận/Từ chối trách nhiệm. Không có nút "Đã xem" ở đâu cả:
  // mở tab KCS của ngăn chi tiết = tổ đã xem (18/09/2026), kể cả mở từ danh sách ngoài bàn. Lặng lẽ:
  // không toast, không khoá nút của ngăn — nhãn "Tổ đã xem (…) · giờ" hiện ngay trong tab là đủ báo.
  const kcsLoiChoXem = useMemo(() => new Set((choXn?.kcs_loi ?? []).map((l) => l.loi_id)), [choXn]);
  const onXemKcs = useCallback((loiIds: number[]) => {
    if (!token) return;
    void Promise.all(loiIds.map((id) => api.sanXuat.daXemLoiKcs(token, id)))
      .then(() => {
        loadItems();
        onBadgeStale?.();
      })
      .catch(handleErr)
      .finally(() => setG5Tick((t) => t + 1));
  }, [token, loadItems, onBadgeStale, handleErr]);

  const onMoBanGiaoCho = useCallback((dichCongViecId: number) => {
    setTabDau("gn");
    setMoLan((n) => n + 1);
    setSelectedId(dichCongViecId);
  }, []);
  // "Mở" lỗi KCS: ngăn chi tiết công đoạn bị báo lỗi, mở thẳng tab KCS.
  const onMoKcsCho = useCallback((congViecId: number) => {
    setTabDau("kcs");
    setMoLan((n) => n + 1);
    setSelectedId(congViecId);
  }, []);

  const ver = () => chiTiet?.version;

  const onGiao = useCallback((employeeId: number) => {
    if (selectedId == null) return;
    void mutate(() => api.sanXuat.phanCong(token!, selectedId, { employee_id: employeeId, expected_version: ver() }),
      "Đã giao người vào việc.");
  }, [mutate, token, selectedId, chiTiet]);

  const onRut = useCallback((phanCongId: number) => {
    if (selectedId == null) return;
    void mutate(() => api.sanXuat.rut(token!, phanCongId, { expected_version: ver() }),
      "Đã rút người khỏi việc.");
  }, [mutate, token, selectedId, chiTiet]);

  // Đổi máy §7.2 mở rộng — `ver()` cần `chiTiet` tươi trong deps (khác các mặt exec khác vốn nhận
  // version qua tham số của người gọi), nên tách riêng thay vì viết trực tiếp trong `exec` useMemo.
  const onDoiMay = useCallback((mayId: number, lyDo?: string | null) => mutate(() => api.sanXuat.doiMay(token!, selectedId!, {
    may_id: mayId, ly_do: lyDo ?? null, expected_version: ver(),
  }), "Đã đổi máy.").then((r) => r != null), [mutate, token, selectedId, chiTiet]);

  // Báo sự cố §7.2 mở rộng — cùng lý do tách riêng như `onDoiMay`: cần `chiTiet` tươi cho `ver()`.
  // Toast gọi tên MÃ YÊU CẦU vừa sinh để tổ trưởng bám theo được ở màn Sửa chữa máy; `mutate` chỉ
  // nhận chuỗi cố định nên tự đặt toast sau khi có kết quả.
  const onBaoSuCo = useCallback((body: SxSuCoIn) => mutate(
    () => api.sanXuat.baoSuCo(token!, selectedId!, { ...body, expected_version: ver() }),
    "Đã gửi báo sự cố tới tổ sửa chữa.",
  ).then((r) => {
    if (r) setToast(`Đã gửi ${r.yeu_cau_ma} tới tổ sửa chữa${body.dung_san_xuat ? ", việc đã tạm dừng" : ""}.`);
    return r != null;
  }), [mutate, token, selectedId, chiTiet]);

  // Bắt đầu / Tiếp tục: thẳng, không hỏi gì — kíp chuẩn đã gỡ (mg `0321`) nên không còn "số người
  // khác dự kiến"; sớm hay trễ so với giờ dự kiến cũng không hỏi.
  const onBatDau = useCallback(() => {
    if (selectedId != null) void mutate(() => api.sanXuat.batDau(token!, selectedId, { expected_version: ver() }),
      chiTiet?.trang_thai === "paused" ? "Đã tiếp tục." : "Đã bắt đầu.");
  }, [chiTiet, mutate, token, selectedId]);

  // Nhận / trả khuôn (04/09/2026). Nhận là thứ DUY NHẤT mở cổng Bắt đầu cho bước cần dụng cụ —
  // không hỏi lý do gì cả: người bấm là người đang cầm con dao trong tay.
  const onNhanKhuon = useCallback(() => {
    if (selectedId != null) {
      void mutate(() => api.sanXuat.nhanKhuon(token!, selectedId), "Đã nhận khuôn.");
    }
  }, [mutate, token, selectedId]);

  const onTraKhuon = useCallback(() => {
    if (selectedId != null) {
      void mutate(() => api.sanXuat.traKhuon(token!, selectedId), "Đã trả khuôn về kệ.");
    }
  }, [mutate, token, selectedId]);

  // Tạm dừng: lý do BẮT BUỘC luôn.
  const onTamDung = useCallback(() => {
    setReason({ kind: "tam_dung" });
  }, []);

  // Kết thúc: không hỏi lý do, sớm hay trễ đều bấm là xong.
  const onKetThuc = useCallback(() => {
    if (selectedId != null) void mutate(() => api.sanXuat.ketThuc(token!, selectedId, { expected_version: ver() }), "Đã kết thúc.");
  }, [chiTiet, mutate, token, selectedId]);

  // Nút chạy nhanh trên DÒNG bảng đã GỠ (28/09/2026): nhãn trạng thái đứng cạnh nút "Tạm dừng /
  // Kết thúc" đọc ra thành ba trạng thái. Bắt đầu · Tạm dừng · Kết thúc chỉ còn ở chân drawer.

  const confirmReason = useCallback((txt: string) => {
    if (!reason || selectedId == null) return;
    void mutate(() => api.sanXuat.tamDung(token!, selectedId, { ly_do: txt, expected_version: ver() }), "Đã tạm dừng.");
  }, [reason, mutate, token, selectedId, chiTiet]);

  // ---- Giai đoạn 3+4: hợp đồng các mặt GHI cho drawer (mọi mặt qua `mutate` → refetch + toast) ----
  const exec = useMemo<ThsxExec>(() => {
    const ok = (p: Promise<unknown | null>) => p.then((r) => r != null);
    return {
      doiMay: onDoiMay,
      baoSuCo: onBaoSuCo,
      taoBatch: (b) => mutate(() => api.sanXuat.taoBatch(token!, selectedId!, b), "Đã ghi sản lượng.")
        .then((r) => (r ? r.ket_qua_lsx ?? [] : null)),
      deXuatBanGiao: (b) => ok(mutate(() => api.sanXuat.deXuatBanGiao(token!, selectedId!, b), "Đã đề xuất bàn giao.")),
      suaBanGiao: (id, b) => ok(mutate(() => api.sanXuat.suaBanGiao(token!, id, b), "Đã chọn lại sản lượng của lần giao.")),
      xacNhanBanGiao: (id, v) => ok(mutate(() => api.sanXuat.xacNhanBanGiao(token!, id, { expected_version: v }), "Đã xác nhận bàn giao.")),
      suaSoMe: (batchId, b) => ok(mutate(() => api.sanXuat.suaSoMe(token!, batchId, b), "Đã sửa số sản lượng.")),
      // Đề nghị cấp vật tư: 400 = vi phạm nghiệp vụ, `handleErr` hiện NGUYÊN VĂN câu tiếng Việt
      // của BE (kho đã lập phiếu, đề nghị đã huỷ…) — không nuốt thành "Có lỗi xảy ra".
      deNghiVatTu: (cvId, b) => ok(mutate(() => api.sanXuat.deNghiVatTu(token!, cvId, b), "Đã gửi đề nghị cấp vật tư.")),
      nhapLaiVatTu: (cvId, b) => ok(mutate(() => api.sanXuat.nhapLaiVatTu(token!, cvId, b), "Đã gửi yêu cầu nhập kho — kho sẽ lập phiếu nhập.")),
      suaDeNghiVatTu: (cvId, dnId, b) => ok(mutate(() => api.sanXuat.suaDeNghiVatTu(token!, cvId, dnId, b), "Đã lưu đề nghị cấp vật tư.")),
      capNhatDanhMucMe: (batchId) => ok(mutate(() => api.sanXuat.capNhatDanhMucMe(token!, batchId), "Đã cập nhật sản lượng theo danh mục.")),
    };
  }, [mutate, token, selectedId, toCuaViec, onDoiMay, onBaoSuCo]);

  const panelOpen = selectedId != null;

  // Ngăn chi tiết là lớp NỔI (trượt từ phải, nền mờ) như drawer danh mục — Esc đóng như ở đó.
  // Nhường Esc cho lớp trên nó: hộp thoại xác nhận (`.cdlg-overlay`), ngăn phải mở đè lên bàn tổ
  // (`.kt-man` — form Kho của tab Vật tư, tự đóng bằng Esc và tự hỏi khi đang gõ dở) và ô nào đã tự
  // nuốt phím.
  useEffect(() => {
    if (!panelOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector(".cdlg-overlay, .kt-man")) return;
      closePanel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [panelOpen, closePanel]);

  // ============================ view Lịch (khuôn bàn Xếp lịch) ===============
  const TT_LICH: { k: TtLich; nhan: string; so: number }[] = [
    { k: "running", nhan: "Đang chạy", so: digest.running },
    { k: "paused", nhan: "Tạm dừng", so: digest.paused },
    { k: "released", nhan: "Chờ làm", so: digest.released },
    { k: "completed", nhan: "Hoàn thành", so: digest.completed },
  ];
  const coLocLich = !!q || ttLich !== null;
  const lichView = view !== "lich" ? null : (
    <div className="xa thsx-xa">
      <header className="xa-dau thsx-xa__dau">
        <div className="xa-kn">
          <button type="button" className={`xa-kn__nay${coHomNay ? " is-trong" : ""}`} onClick={() => veNgay(homNayStr)}
            title={coHomNay ? "Hôm nay đang nằm trong khoảng xem" : "Về khoảng có hôm nay"}>
            <i />Hôm nay
          </button>
          <div className={`xa-kn__hop${moKhoang ? " is-mo" : ""}`}>
            <button type="button" className="xa-kn__mui" aria-label="Khoảng trước" title="Lùi một khoảng" onClick={() => luiTien(-1)}><ChevronLeft size={17} /></button>
            <button type="button" className="xa-kn__giua" aria-haspopup="dialog" aria-expanded={moKhoang}
              title="Chọn khoảng ngày" onClick={() => setMoKhoang((m) => !m)}>
              <span className="xa-kn__lich"><CalendarDays size={14} /></span>
              <NhanKhoang tu={winTu} den={winDen} />
              {coNhin === "tuan" && <span className="xa-kn__phu">tuần {soTuan(winTu)}</span>}
              {!coNhin && <span className="xa-kn__phu">{soNgay} ngày</span>}
            </button>
            <button type="button" className="xa-kn__mui" aria-label="Khoảng sau" title="Tới một khoảng" onClick={() => luiTien(1)}><ChevronRight size={17} /></button>
          </div>
          <div className="xa-kn__co" role="group" aria-label="Cỡ nhìn">
            {CO_NHIN.map((c) => (
              <button key={c.id} type="button" aria-pressed={coNhin === c.id} onClick={() => chonCo(c.id)}>{c.ten}</button>
            ))}
          </div>
        </div>
        {moKhoang && (
          <XlKhoangNgay tu={winTu} den={winDen} onDong={() => setMoKhoang(false)}
            onApDung={(a, b) => { setKhoang([a, b]); setMoKhoang(false); }} />
        )}
        <span className="xa-ngan-dung" />
        <label className="xa-o-tim">
          <Search size={15} />
          <input ref={oTimLichRef} value={q} placeholder="Tìm mã, công đoạn, máy, khách" aria-label="Tìm trong việc của tổ"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") { setQ(""); (e.target as HTMLInputElement).blur(); } }} />
          {q ? (
            <button type="button" className="xa-btn xa-btn--tron" style={{ height: 22, padding: 0 }} aria-label="Xoá ô tìm" onClick={() => setQ("")}><X size={13} /></button>
          ) : <kbd>/</kbd>}
        </label>
        <ONutCho so={soChoXn} bat={chiCho} onDoi={setChiCho} />
        <span className="xa-gian" />
        <button type="button" className={`xa-btn${khayMo ? " xa-btn--bat" : ""}`} aria-pressed={khayMo} onClick={() => setKhayMo((m) => !m)}>
          <Inbox size={15} />Hàng chờ<span className="xa-dem">{soCho}</span>
        </button>
      </header>

      <div className="xa-tom">
        <span><span className="xa-tom__so thsx-num">{digest.tong}</span> việc</span>
        <span>Trong khoảng này tổ đã chạy <span className="xa-tom__so">{gioChu(phutLich.thucTe)}</span></span>
        <span>Kế hoạch <span className="xa-tom__so">{gioChu(phutLich.keHoach)}</span></span>
        {TT_LICH.map((t) => (
          <button key={t.k} type="button" className={`xa-ln${t.so === 0 && ttLich !== t.k ? " xa-ln--mo" : ""}`}
            aria-pressed={ttLich === t.k} onClick={() => setTtLich(ttLich === t.k ? null : t.k)}>
            <i className={`thsx-xa-cham thsx-xa-cham--${t.k}`} />{t.nhan}<span className="xa-tom__so thsx-num">{t.so}</span>
          </button>
        ))}
        {coLocLich && <button type="button" className="xa-lk" onClick={() => { setQ(""); setTtLich(null); }}>Xoá bộ lọc</button>}
        <span className="xa-gian" />
        {lichLv.cacCa.map((c) => (
          <span key={`${c.ten}${c.tu}`} className="xa-ca"><Clock size={13} />{c.ten} {c.tu} đến {c.den}</span>
        ))}
      </div>

      <div className="xa-than">
        <main className="xa-luoi">
          {err ? (
            <div className="thsx-centerempty"><BangLoi text={err} onRetry={loadItems} /></div>
          ) : items == null ? (
            <TimelineSkeleton />
          ) : (
            <ThsxLichNgay
              tu={winTu}
              soNgay={soNgay}
              dangTim={coLocLich}
              viec={groups.timed}
              selectedId={selectedId}
              onChon={pickViec}
              cho={choMap}
            />
          )}
        </main>
        {/* KHAY HÀNG CHỜ — việc KHÔNG vẽ được lên lưới đang xem (chưa định giờ / ngoài khoảng ngày). Việc
            trong khoảng đã là một dòng trên lưới nên không lặp lại ở đây. */}
        {khayMo && (
          <aside className="xa-khay thsx-xa-khay" aria-label="Hàng chờ">
            <div className="xa-khay__dau">
              Hàng chờ <span className="xa-dem">{soCho}</span>
              <span className="xa-gian" />
              <button type="button" className="xa-btn xa-btn--tron xa-btn--o" title="Thu khay" aria-label="Thu khay Hàng chờ" onClick={() => setKhayMo(false)}>
                <ChevronsRight size={16} />
              </button>
            </div>
            <div className="xa-khay__sap"><span>Chưa định giờ và ngoài khoảng ngày đang xem</span></div>
            <div className="xa-khay__ds">
              {err ? null : items == null ? (
                <ListSkeleton />
              ) : soCho === 0 ? (
                // Không tách nhánh "chưa có việc phát hành": `items` chỉ là việc của KHOẢNG NGÀY đang xem,
                // dời sang tuần trống thì tổng về 0 dù tổ vẫn còn việc ở tuần khác.
                <p className="xa-khay__chan" style={{ borderTop: 0 }}>{coLocLich
                  ? "Không có việc chờ nào khớp ô tìm hoặc lọc nhanh."
                  : chiCho
                    ? "Không có công đoạn chờ xác nhận nào nằm ngoài lịch."
                    : "Tất cả việc của tổ đều đã nằm trên lịch."}</p>
              ) : (
                <>
                  <ListSection label="Chưa định giờ" icon="clock" viec={groups.untimed}
                    selectedId={selectedId} onPick={pickViec} cho={choMap} />
                  <ListSection label="Ngoài khoảng ngày" icon="history" viec={groups.outWin}
                    selectedId={selectedId} onPick={pickViec} cho={choMap} />
                </>
              )}
            </div>
          </aside>
        )}
      </div>

      {/* Chú giải hai làn của mỗi dòng: kế hoạch (trên) và thực tế theo trạng thái (dưới). Chờ làm chưa
          có làn thực tế nên không có ô mẫu riêng. */}
      <div className="thsx-foot">
        <div className="thsx-foot__legend" aria-hidden="true">
          <span className="thsx-lg thsx-lg--kh"><i /> Kế hoạch</span>
          <span className="thsx-lg__nhom">Thực tế</span>
          <span className="thsx-lg thsx-lg--running"><i /> Đang chạy</span>
          <span className="thsx-lg thsx-lg--paused"><i /> Tạm dừng</span>
          <span className="thsx-lg thsx-lg--completed"><i /> Hoàn thành</span>
        </div>
        <div className="thsx-foot__spacer" />
      </div>
    </div>
  );

  // ============================ render =======================================
  return (
    <div className="thsx">
      {/* Thanh trên */}
      <div className="thsx-top">
        <header className="lds-dau">
          <h1 className="lds-dau__ten">Bàn tổ<span className="thsx-top__to">{tenTo ?? `#${teamId}`}</span></h1>
          <div className="lds-dau__nut">
            <div className="thsx-seg" role="group" aria-label="Kiểu xem">
              <button type="button" className="thsx-seg__btn" title="Xem danh sách bản ghi (Bảng)"
                aria-pressed={view === "danh_sach"} onClick={() => setView("danh_sach")}>
                <Icon name="table" size={13} /> Bảng
              </button>
              <button type="button" className="thsx-seg__btn" title="Xem theo lịch (Gantt)"
                aria-pressed={view === "lich"} onClick={() => setView("lich")}>
                <Icon name="layout" size={13} /> Lịch
              </button>
              <button type="button" className="thsx-seg__btn" title="Sản lượng theo lệnh, công đoạn, người"
                aria-pressed={view === "san_luong"} onClick={() => { setSelectedId(null); setView("san_luong"); }}>
                <Icon name="activity" size={13} /> Sản lượng
              </button>
            </div>
          </div>
        </header>
      </div>

      {view === "san_luong" ? (
        <ThsxSanLuongTab teamId={teamId} eventTick={eventTick} />
      ) : (<>
      {/* Việc chờ TỔ bấm (bàn giao đến, lỗi KCS) gắn vào công đoạn của nó (§11.5); chỉ
          việc không có dòng trên bàn mới liệt kê riêng, khi bật ô "chờ xác nhận". */}
      {chiCho && <ThsxChoNgoaiBan
        data={ngoaiBan}
        busy={busy}
        onMoBanGiao={onMoBanGiaoCho}
        onMoKcs={onMoKcsCho}
      />}

      {/* Thanh lọc — CHỈ view Bảng. View Lịch để số liệu trên thanh trên và ô tìm ở đầu cột Hàng chờ,
          như bàn Xếp lịch. Hàng chip dưới thanh CHÍNH LÀ bộ chọn Trạng thái (điều kiện "Trạng thái"
          trong menu Lọc không vẽ khối riêng); số đếm của máy chủ tính TRƯỚC lọc trạng thái nên chip
          chưa chọn vẫn nói còn bao nhiêu việc. */}
      {view === "danh_sach" && (
        <div className="lds thsx-lds">
          <section className="lds-loc">
            <div className="lds-loc__thanh tl-thanh" role="search">
              <OTim value={q} onChange={setQ} placeholder="Tìm mã / khách / công đoạn / máy…"
                ariaLabel="Tìm trong việc của tổ" />
              <ThanhLoc ky={locMan.ky} moc={MOC_BAN_TO} onKy={(ky) => setLocMan({ ...locMan, ky })}
                dieuKien={dieuKienBan} loc={locMan.loc} onLoc={(loc) => setLocMan({ ...locMan, loc })} />
              <ThsxSapXepNut value={sapXep} onChange={(v) => setLocMan({ ...locMan, sapXep: v })} />
              <ChonCot cot={COT_THSX} {...luoi.chonCot} />
            </div>
            <ThsxDemTrangThai dem={demTT} chon={locMan.loc.trangThai} onChon={datTrangThai}
              cho={{
                so: { ban_giao: choXn?.ban_giao.length ?? 0, kcs: choXn?.kcs_loi.length ?? 0 },
                chon: locMan.loc.cho,
                onChon: (cho) => setLocMan({ ...locMan, loc: { ...locMan.loc, cho } }),
              }} />
          </section>
        </div>
      )}

      {/* Lưới tràn màn: view Bảng là bảng lệnh, view Lịch là khối lịch theo khuôn bàn Xếp lịch (thanh
          điều khiển, dòng tóm tắt, lưới không cột nhãn, khay Hàng chờ bên phải, chú giải). Ngăn chi
          tiết là lớp nổi, không chiếm cột. */}
      <div className={`thsx-grid thsx-grid--full${panelOpen ? " is-panel" : ""}`}>
        <section className="thsx-center thsx-col--center">
          {view === "lich" ? lichView : err ? (
            <div className="thsx-centerempty"><BangLoi text={err} onRetry={loadItems} /></div>
          ) : lenh == null ? (
            <ListSkeleton />
          ) : (
            (lenh ?? []).length === 0 ? (
              <div className="thsx-centerempty">
                <EmptyState icon={q || coLoc ? "search" : "check"}
                  title={q ? "Không khớp tìm kiếm" : chiCho ? "Không có lệnh nào trên bàn đang chờ xác nhận"
                    : coLoc ? "Không có lệnh nào khớp bộ lọc"
                      : laTho ? "Chưa có việc nào ở tổ này giao cho bạn" : "Chưa có việc phát hành"}
                  sub={q ? "Thử đổi từ khoá."
                    : chiCho ? "Việc chờ còn lại thuộc công đoạn ngoài bàn này — xem danh sách phía trên."
                      : coLoc ? "Nới kỳ hoặc bỏ bớt điều kiện lọc."
                        : laTho ? "Khi có việc giao cho bạn, việc sẽ hiện ở đây."
                          : "Khi một gói được phát hành, việc của tổ sẽ hiện ở đây."} />
              </div>
            ) : (
              <>
                <ThsxDanhSach
                  lenh={lenh ?? []}
                  selectedId={selectedId}
                  onPick={pickViec}
                  cho={choMap}
                  luoi={luoi}
                  cotAn={luoi.an}
                  thuTu={luoi.thuTu}
                />
                {/* Chân phân trang theo LỆNH (máy chủ cắt trang): "N dòng" là số việc đang hiện,
                    tổng đếm theo lệnh — một lệnh không bị xé qua hai trang. */}
                {tongLenh > 0 && (
                  <div className="lds-sheet thsx-lds-chan">
                    <PhanTrangDayDu trang={trang} size={coTrang} tong={tongLenh} soDong={(lenh ?? []).reduce((t, l) => t + l.cong_viec.length, 0)}
                      onTrang={setTrang} onSize={(n) => { setCoTrang(n); setTrang(1); }}
                      donVi="lệnh" ariaLabel="Phân trang lệnh của tổ" />
                  </div>
                )}
                {/* Chú giải chấm "Hàng đang tới đâu" — dưới phân trang như mockup; ẩn cột thì thôi. */}
                {!luoi.an.has("tuyen") && <ThsxTuyenChuGiai />}
              </>
            )
          )}
        </section>

        {/* NGĂN CHI TIẾT — lớp nổi trượt từ phải (không chiếm cột lưới) */}
        <aside className={`thsx-panel${panelOpen ? " thsx-panel--open" : ""}`}
          aria-label="Chi tiết công việc đang chọn">
          {panelOpen && (
            // Ngăn chi tiết vẽ hỏng thì chỉ ngăn này báo lỗi — bảng việc, hộp thư, đăng nhập đứng
            // nguyên. Không bọc thì một lỗi vẽ gỡ cả ứng dụng (xem `ErrorBoundary`).
            <ErrorBoundary
              // `key`: đổi công việc chọn phải REMOUNT cả drawer, không chỉ đổi prop — review vòng
              // 1, Minor 5. State nội bộ (`doiMayOpen`/`mayChonId`/`lyDoMay`, `giaoOpen`/`moKhoang`)
              // trước đây sống qua lần đổi `selectedId` vì component không unmount, để lại form
              // "Đổi máy" còn mở hoặc còn chọn dở máy của công việc TRƯỚC khi bấm sang việc khác.
              // Đặt ở ranh giới nên chọn việc khác cũng xoá luôn trạng thái lỗi.
              key={`${selectedId}:${moLan}`}
              fallback={(thuLai) => <NganChiTietLoi onThuLai={thuLai} onClose={closePanel} />}
            >
            <ThsxDrawer
              tabDau={tabDau}
              dinhKemDem={dinhKemDem}
              kcsTick={(eventTick ?? 0) + g5Tick}
              kcsLoiChoXem={kcsLoiChoXem}
              cho={selectedId != null ? choMap.get(selectedId) : undefined}
              onXemKcs={onXemKcs}
              chiTiet={chiTiet}
              loading={ctLoading}
              candidates={candidates}
              hoTroUngVien={hoTroUngVien}
              ungVienHomNay={ungVienHomNay}
              onMoChonNguoi={lamMoiUngVien}
              mayOptions={mayOptions}
              exec={exec}
              busy={busy}
              onGiao={onGiao}
              onRut={onRut}
              onBatDau={onBatDau}
              onNhanKhuon={onNhanKhuon}
              onTraKhuon={onTraKhuon}
              onTamDung={onTamDung}
              onKetThuc={onKetThuc}
              onClose={closePanel}
              tenTo={tenTo}
            />
            </ErrorBoundary>
          )}
        </aside>
      </div>

      {/* Nền mờ phía sau ngăn chi tiết — bấm ra ngoài là đóng */}
      {panelOpen && <div className="thsx-scrim" onClick={closePanel} aria-hidden="true" />}

      </>)}

      {/* Hộp Tạm dừng — lý do bắt buộc */}
      {reason && (
        <ThsxTamDungHop busy={busy}
          phuDe={chiTiet ? (chiTiet.cong_viec.nguon_ma ? `${chiTiet.cong_viec.ten_cong_doan} của ${chiTiet.cong_viec.nguon_ma}` : chiTiet.cong_viec.ten_cong_doan) : undefined}
          onDong={() => setReason(null)} onTamDung={confirmReason} />
      )}

      {toast && <div className="thsx-toast" role="status">{toast}</div>}
    </div>
  );
}

// ============================ danh sách trái — 1 nhóm ======================
function ListSection({
  label, icon, viec, selectedId, onPick, cho,
}: {
  label: string;
  icon: Parameters<typeof Icon>[0]["name"];
  viec: SxWorkItem[];
  selectedId: number | null;
  onPick: (w: SxWorkItem) => void;
  cho?: ReadonlyMap<number, SxChoCuaViec>;
}) {
  if (viec.length === 0) return null;
  return (
    <div className="thsx-lsec">
      <div className="thsx-lsec__label">
        <Icon name={icon} size={12} /> {label}
        <span className="thsx-lsec__n thsx-num">{viec.length}</span>
      </div>
      {viec.map((w) => (
        <ListRow key={w.id} w={w} selected={w.id === selectedId} onPick={() => onPick(w)} cho={cho?.get(w.id)} />
      ))}
    </div>
  );
}

function ListRow({ w, selected, onPick, cho }: {
  w: SxWorkItem; selected: boolean; onPick: () => void; cho?: SxChoCuaViec;
}) {
  return (
    <button type="button" className={`thsx-lrow${selected ? " thsx-lrow--sel" : ""}`}
      aria-pressed={selected} onClick={onPick}>
      <div className="thsx-lrow__top">
        <Icon name={sxNguonIcon(w.nguon_loai)} size={13} className="thsx-lrow__nic" />
        <span className="thsx-lrow__serial thsx-num">{sxSerial(w.nguon_ma)}</span>
        <ChamCho c={cho} />
        <span className="thsx-lrow__spacer" />
        <ThsxTrangThaiPill tt={w.trang_thai} size="xs" />
      </div>
      <div className="thsx-lrow__cd">{w.ten_cong_doan || "—"}</div>
      <div className="thsx-lrow__meta">
        {w.may && <span className="thsx-lrow__may"><Icon name="printer" size={11} /> {w.may}</span>}
        {w.chay_phut != null && w.chay_phut > 0 && (
          <span className="thsx-lrow__gio thsx-num" title="Thời gian làm dự kiến"><Icon name="clock" size={11} /> {thoiLuong(w.chay_phut)}</span>
        )}
        {w.nhan_luc && (
          <span className="thsx-lrow__gio thsx-num" title="Lúc tổ nhận việc">Nhận {ngayGio(w.nhan_luc)}</span>
        )}
        <ChipKcs so_lan={w.kcs_so_lan} loi={w.kcs_loi} />
        <ChipLoaiBuoc loai_buoc={w.loai_buoc} nha_cung_cap={w.nha_cung_cap} />
        <ChipKhuon can_khuon={!!w.khuon} khuon={{ ...(w.khuon ?? {}), da_nhan: w.khuon_da_nhan }} />
      </div>
    </button>
  );
}

// ===================== ô "chờ xác nhận" trên thanh lọc ======================
/** Đếm việc chờ tổ bấm + công tắc lọc bảng về các lệnh có việc chờ (máy chủ lọc, §11.5). Không có
 *  việc chờ và đang tắt thì không chiếm chỗ. */
export function ONutCho({ so, bat, onDoi }: { so: number; bat: boolean; onDoi: (b: boolean) => void }) {
  if (so === 0 && !bat) return null;
  return (
    <button type="button" className={`thsx-cho-chip${bat ? " is-on" : ""}`} aria-pressed={bat}
      title={bat ? "Đang chỉ hiện lệnh có việc chờ tổ xác nhận — bấm để xem lại tất cả"
        : "Chỉ hiện lệnh có việc chờ tổ xác nhận"}
      onClick={() => onDoi(!bat)}>
      <span className="thsx-cho-chip__dot" aria-hidden="true" />
      <b className="thsx-num">{so}</b> chờ xác nhận
      {bat && <Icon name="x" size={12} />}
    </button>
  );
}

// ======================= ngăn chi tiết vẽ hỏng ==============================
/** Thay ngăn chi tiết khi nó ném lỗi lúc vẽ. Giữ đầu ngăn + nút Đóng như bản thường để người
 *  dùng thoát ra bằng đúng chỗ quen tay; câu chữ nói việc cần làm, không bày thông báo kỹ thuật. */
export function NganChiTietLoi({ onThuLai, onClose }: { onThuLai: () => void; onClose: () => void }) {
  return (
    <div className="thsx-panel__inner">
      <div className="thsx-panel__head">
        <div className="thsx-panel__title">
          <span className="thsx-panel__cd">Chi tiết công việc</span>
        </div>
        <button type="button" className="thsx-panel__close" onClick={onClose} aria-label="Đóng">
          <Icon name="x" size={16} />
        </button>
      </div>
      <div className="empty-state empty-state--inline empty-state--loi" role="alert">
        <Icon name="alert" size={40} />
        <p className="empty-state__title">Không hiển thị được chi tiết công việc này</p>
        <p className="empty-state__sub">
          Bảng việc và các thao tác khác vẫn dùng bình thường. Bấm Thử lại, hoặc đóng ngăn rồi chọn
          lại công việc. Lặp lại nhiều lần thì báo quản trị hệ thống.
        </p>
        <button type="button" className="btn btn--ghost" onClick={onThuLai}>
          Thử lại
        </button>
      </div>
    </div>
  );
}

// ============================ skeleton lúc tải ==============================
function TimelineSkeleton() {
  const rows: [number, number][] = [
    [8, 42], [26, 30], [4, 54], [36, 28], [12, 46], [30, 34], [6, 50], [20, 38],
  ];
  return (
    <div className="thsx-skel" role="status" aria-label="Đang tải bàn làm việc">
      {rows.map(([off, w], i) => (
        <div className="thsx-skel__row" key={i}>
          <div className="thsx-skel__lbl" />
          <div className="thsx-skel__bar" style={{ marginLeft: `${off}%`, width: `${w}%` }} />
        </div>
      ))}
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="thsx-skel-q" role="status" aria-label="Đang tải danh sách việc">
      {[0, 1, 2, 3].map((i) => <div className="thsx-skel__q" key={i} />)}
    </div>
  );
}
