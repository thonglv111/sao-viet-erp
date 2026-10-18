// Báo giá (Quotation / Quote) — spec-09, Phase 2B/2C/2D.
// Danh sách phiếu (mã+version, khách, tổng giá bán, trạng thái, hạn hiệu lực) + Tạo/Sửa
// (H-V-I structure, multi-quantity spreadsheet pricing table, version timeline, PDF preview & Order handoff).
import {
  Fragment,
  useCallback,
  useEffect,
  useState,
} from "react";
import {
  ApiError,
  api,
  anhNho, assetUrl,
  type EnumOption,
  type QuotationActivity,
  type QuotationDetail,
  type QuotationEnumsOut,
  type QuotationRow,
  type QuotationStats,
  type QuoteItemDetail,
} from "../api/client";
import { gopTheoNhom, gopTrungTen, nhomLechSoLuong } from "../utils/gop-nhom";
import { useAuth } from "../auth/useAuth";
import { useCan } from "../auth/permissions";
import { Button } from "../components/Button";
import { ChonNgay } from "../components/ChonNgay";
import { EmptyRow, EmptyState } from "../components/EmptyState";
import {
  CuonLuoi,
  ChipTT,
  ChonCot,
  LocNhanhTrangThai,
  OTim,
  rongLuoi,
  TieuDeSapXep,
  ngayVN,
  soVN,
  tenKhachGon,
  useCauHinhLuoi,
  type CotLuoi,
  type MauTT,
} from "../components/LuoiDs";
import { LocNguoiPhuTrach } from "../components/LocNguoiPhuTrach";
import { PhanTrangDayDu } from "../components/PhanTrangDayDu";
import { DaiKhachHang } from "../components/DaiKhachHang";
import { ONhapSo } from "../components/ONhapSo";
import { OHaiTab, type Kieu } from "../components/OHaiTab";
import { LOC_BG_TRONG, locBGLenUrl, locBGTuUrl, thamSoLocBG, useDieuKienBaoGia, type LocBaoGia } from "./loc-kinh-doanh/dieu-kien-bao-gia";
import { ThanhLoc } from "./thanh-loc/ThanhLoc";
import { dkTheoTab } from "./thanh-loc/thanh-loc";
import "./loc-kinh-doanh/loc-kinh-doanh.css";
import { kyLenUrl, kyTuUrl, thamSoKy, type KyDS } from "./thanh-loc/ky-danh-sach";
import { useLocMan } from "./thanh-loc/useLocMan";
// Đầu trang bản in = ĐÚNG tấm letterhead giấy của công ty (tên + logo + thông tin liên hệ + 4
// huy hiệu chứng nhận + viền kép, đã nằm sẵn trong ảnh) — chủ xưởng đưa file, chốt 10/09/2026.
// Trước đây khối này dựng bằng HTML từ 5 ảnh rời + SVN_COMPANY: mỗi lần letterhead giấy đổi là
// phải sửa code, mà chữ dựng lại vẫn không khớp bản in thật.
import letterheadUrl from "../assets/letterhead-sao-viet-nhat.jpg";
import { useInTuDong } from "./bao-gia-in-tu-dong";
import {
  Activity,
  AlertCircle,
  ArrowLeftRight,
  ArrowRight,
  ArrowUpFromLine,
  Ban,
  Calendar,
  Check,
  ChevronLeft,
  CornerDownLeft,
  DollarSign,
  ExternalLink,
  FileText,
  GitBranch,
  History,
  ImagePlus,
  Lock,
  Paperclip,
  Pencil,
  Plus,
  Printer,
  RefreshCw,
  Save,
  Send,
  Table,
  TriangleAlert,
  Undo2,
  X,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import "./bao-gia.css";

// Điều khoản MẶC ĐỊNH điền sẵn khi tạo báo giá (khớp DEFAULT_TERMS backend). Mỗi dòng = 1 điều
// khoản; bản in tự đánh số 1..N theo dòng. Sale sửa thoải mái trước khi gửi khách.
const DEFAULT_TERMS = [
  "Bản báo giá có hiệu lực trong vòng 30 ngày kể từ ngày báo giá.",
  "Thời gian giao mẫu 5 ngày kể từ khi duyệt file.",
  "Thời gian giao hàng từ 7 - 10 ngày kể từ ngày duyệt mẫu in.",
  "Đơn giá trên đã bao gồm phí vận chuyển tận nơi đến khách hàng.",
  "Thời hạn thanh toán: 60 ngày kể từ ngày giao hàng và xuất hóa đơn tài chính.",
  "Để biết thêm chi tiết về sản phẩm vui lòng liên hệ: Mr Sơn – Mobile: 093.313.4668"
].join("\n");

// Thông tin công ty in trên báo giá — Sao Việt Nhật. Số liệu lấy từ letterhead thật của công ty.
const SVN_COMPANY = {
  name: "CÔNG TY CỔ PHẦN IN SAO VIỆT NHẬT",
  nameEn: "Sao Viet Nhat",
  address: "1/473, Khu phố Hòa Lân 2, Phường Thuận Giao, TP. Hồ Chí Minh, VN",
  taxCode: "0312514000",
  phone: "0274 2460 048",
  email: "inansaovietnhat@gmail.com",
  website: "www.saovietnhat.com",
  // Địa danh ban hành ghi trên dòng ngày tháng — theo đúng letterhead công ty đang dùng.
  placeOfIssue: "Bình Dương",
  sender: "—",
  senderEmail: "—",
};

const PAGE_SIZE = 25;

// Dải kỳ của danh sách tính theo một trong ba mốc; cột ngày cuối bảng hiện đúng mốc đang chọn.
const MOC_BG: [string, string][] = [["tao", "Ngày tạo"], ["gui", "Ngày gửi khách"], ["hieu_luc", "Hạn hiệu lực"]];
const COT_SAP_THEO_MOC: Record<string, string> = { tao: "created_at", gui: "sent_at", hieu_luc: "valid_until" };
type LocMan = { ky: KyDS; loc: LocBaoGia };

/** Số đang gõ dở của một dòng báo giá (chưa lưu): chiết khấu `ck`, lợi nhuận `ln` (% hoặc số tiền), giá bán gõ tay `gia`. */
type NhapDong = { ck?: { k: Kieu; v: number }; ln?: { k: Kieu; v: number }; gia?: number };
const LOC_MAN_TRONG: LocMan = { ky: { loai: "tat_ca", moc: "tao" }, loc: LOC_BG_TRONG };
const docLocMan = (p: URLSearchParams): LocMan => ({
  ky: kyTuUrl(p, MOC_BG.map(([m]) => m), "tao"),
  loc: locBGTuUrl(p),
});
const ghiLocMan = (t: LocMan) => ({ ...kyLenUrl(t.ky, "tao"), ...locBGLenUrl(t.loc) });

function labelOf(options: EnumOption[], value: string | null): string {
  if (!value) return "—";
  return options.find((o) => o.value === value)?.label ?? value;
}

function fmtDate(v: string | null): string {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleDateString("vi-VN");
  } catch {
    return v;
  }
}

export function BaoGiaPage({
  openQuoteId = null,
  navigate,
  eventTick = 0,
}: {
  openQuoteId?: number | null;
  navigate?: (id: string, params?: any) => void;
  /** Tăng 1 mỗi lần kênh SSE báo luồng duyệt đổi (AppShell giữ kênh DUY NHẤT, đẩy tick xuống đây).
   *  Vào deps của `load()` → danh sách + số đếm tab tự tươi, không phải F5. */
  eventTick?: number;
} = {}) {
  const { token } = useAuth();

  const [rows, setRows] = useState<QuotationRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(PAGE_SIZE);
  // Hộp lọc NV phụ trách — null = tất cả người trong tầm nhìn.
  const [nguoi, setNguoi] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [enums, setEnums] = useState<QuotationEnumsOut | null>(null);
  // Dải kỳ + bộ lọc nâng cao — ghi lên URL, nhớ theo màn khi mở chi tiết rồi quay lại.
  const [locMan, setLocManGoc] = useLocMan("bao-gia", LOC_MAN_TRONG, docLocMan, ghiLocMan);
  const setLocMan = (t: LocMan) => {
    setLocManGoc(t);
    setPage(1);
  };
  const dkRieng = useDieuKienBaoGia();
  const khoaLoc = JSON.stringify({ ...thamSoKy(locMan.ky), ...thamSoLocBG(locMan.loc) });
  // Mặc định xếp mới nhất theo đúng mốc của cột ngày (mở từ link "theo hạn hiệu lực" thì xếp theo hạn).
  const [sort, setSort] = useState(() => `-${COT_SAP_THEO_MOC[locMan.ky.moc]}`);

  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  // Báo giá đang mở. Chỉ giữ ID — khung chi tiết tự tải; trước đây trang này GET chi tiết một lần
  // chỉ để lấy lại đúng cái id rồi khung chi tiết GET thêm lần nữa.
  const [openId, setOpenId] = useState<number | null>(openQuoteId);

  const [stats, setStats] = useState<QuotationStats | null>(null);
  const [tongGiaBan, setTongGiaBan] = useState(0);
  const luoi = useCauHinhLuoi("bao-gia");
  const xemDon = useCan()("don_hang_ban", "read");

  // Đi từ màn khác tới (phiếu tính giá, CRM, nhật ký): mở thẳng chi tiết.
  useEffect(() => {
    if (openQuoteId != null) setOpenId(openQuoteId);
  }, [openQuoteId]);

  const load = useCallback(() => {
    // Đang mở chi tiết thì danh sách không hiện — khỏi tải; đóng chi tiết là tải lại.
    if (!token || openId != null) return;
    setLoading(true);
    setListError(null);
    api.quotations
      .list(token, {
        q: q.trim() || undefined,
        status: statusFilter || null,
        nguoi,
        sort,
        page,
        size,
        loc: JSON.parse(khoaLoc),
      })
      .then((res) => {
        setRows(res.items);
        setTotal(res.total);
        setTongGiaBan(res.tong_gia_ban ?? 0);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.isForbidden) setForbidden(true);
        else setListError("Không tải được danh sách báo giá.");
      })
      .finally(() => setLoading(false));

    // Số đếm cho thanh tab — theo ĐÚNG ô tìm, kỳ, bộ lọc đang áp: bấm tab nào bảng ra đúng số đó.
    api.quotations
      .stats(token, nguoi, { q: q.trim() || undefined, ...JSON.parse(khoaLoc) })
      .then(setStats)
      .catch(() => setStats(null));
    // eventTick: SSE báo có trình duyệt / có quyết định → chạy lại cả list lẫn stats.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, q, statusFilter, sort, page, size, eventTick, nguoi, openId, khoaLoc]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!token) return;
    api.quotations
      .enums(token)
      .then(setEnums)
      .catch(() => setEnums(null));
  }, [token]);

  function openDetail(row: QuotationRow) {
    setOpenId(row.id);
  }

  const statuses = enums?.statuses ?? [];
  // Tab trạng thái đếm số — "Cần xử lý" = nháp + đã gửi chờ khách. Dùng chung cho thanh tab và
  // điều kiện "Trạng thái" trong nút Lọc (đọc/ghi thẳng tab, không đẻ state lọc thứ hai).
  const tabTrangThai: { key: string; label: string; count?: number; tone?: "alert"; mau?: MauTT }[] = [
    { key: "", label: "Tất cả", count: stats?.total },
    { key: "need_action", label: "Cần xử lý", count: stats?.need_action, tone: "alert" },
    { key: "draft", label: "Soạn", count: stats?.draft },
    // "Chờ duyệt" = báo giá đặc thù đã Trình duyệt (list đã lọc theo phạm vi → người duyệt
    // thấy đúng "chờ TÔI duyệt"). Tone alert để nổi bật việc cần quyết định.
    { key: "pending_approval", label: "Chờ duyệt", count: stats?.pending_approval, tone: "alert" },
    // "Đã duyệt" cũng tô đỏ: GĐ duyệt xong thì bóng sang chân sale — còn nằm đây là còn
    // việc (phải gửi khách), không phải trạng thái nghỉ.
    { key: "approved", label: "Đã duyệt", count: stats?.approved, tone: "alert" },
    { key: "sent", label: "Đã gửi khách", count: stats?.sent },
    { key: "accepted", label: "Khách đồng ý", count: stats?.accepted },
    { key: "converted_to_order", label: "Đã lên đơn", count: stats?.converted_to_order },
    { key: "rejected", label: "Từ chối", count: stats?.rejected },
    { key: "expired", label: "Hết hiệu lực", count: stats?.expired },
  ];
  const datTrangThai = (k: string) => {
    setStatusFilter(k);
    setPage(1);
  };
  const dieuKien = [
    dkTheoTab<LocBaoGia>({
      tabs: tabTrangThai.map((t) => ({ id: t.key, nhan: t.label, so: t.count })),
      tatCa: "",
      dang: statusFilter,
      dat: datTrangThai,
    }),
    ...dkRieng,
  ];

  if (forbidden) {
    return (
      <main className="rdx-quote">
        <div className="banner banner--error" role="alert">
          Bạn không có quyền truy cập Báo giá (403).
        </div>
      </main>
    );
  }

  // Detail = trang 2 cột in-page (thay danh sách), giống prototype inan5 (viewList ⇄ viewEditor).
  if (openId != null) {
    return (
      <QuotationDetailView
        quotationId={openId}
        statuses={statuses}
        navigate={navigate}
        onClose={() => setOpenId(null)}
        onChanged={() => load()}
      />
    );
  }

  // Cột ngày thứ hai chạy theo mốc kỳ (Ngày tạo / Ngày gửi khách); mốc "Hạn hiệu lực" đã có cột
  // Hiệu lực riêng nên cột này về Ngày tạo.
  const mocNgay = locMan.ky.moc === "gui" ? "gui" : "tao";
  const nhanNgay = mocNgay === "gui" ? "Ngày gửi khách" : "Ngày tạo";
  const hien = (k: string) => !luoi.an.has(k);
  const cotHien = luoi.rongHien(luoi.xep(COT_BG).filter((c) => hien(c.key)).map((c) => (c.key === "ngay" ? { ...c, label: nhanNgay } : c)));
  const viTriGia = cotHien.findIndex((c) => c.key === "gia");
  const muc = tabTrangThai.map((t) => ({ ...t, mau: t.key ? MAU_TRANG_THAI[t.key] : undefined }));

  return (
    <main className="rdx-quote lds">
      <header className="lds-dau">
        <h1 className="lds-dau__ten">Báo giá thương mại</h1>
        {/* Báo giá LUÔN khởi từ 1 Phiếu tính giá (1 PTG → 1 BG): nút này sang màn Tính giá, ở đó
            bấm "Báo giá →" để tạo/mở báo giá. */}
        <div className="lds-dau__nut">
          <Button variant="accent" onClick={() => navigate?.("tinh-gia")}>
            <Plus size={15} /> Báo giá mới
          </Button>
        </div>
      </header>

      <section className="lds-loc">
        <LocNhanhTrangThai muc={muc} dang={statusFilter} onChon={datTrangThai} />
        <div className="lds-loc__thanh tl-thanh" role="search">
          <OTim
            value={q}
            onChange={(v) => {
              setQ(v);
              setPage(1);
            }}
            placeholder="Tìm mã báo giá, khách hàng, sản phẩm"
            ariaLabel="Tìm báo giá"
          />
          <ThanhLoc
            ky={locMan.ky}
            moc={MOC_BG}
            onKy={(ky) => {
              // Đổi mốc thì cột ngày cũng đổi — đang xếp theo cột ngày thì xếp theo mốc mới luôn.
              if (ky.moc !== locMan.ky.moc && Object.values(COT_SAP_THEO_MOC).includes(sort.replace("-", ""))) {
                setSort(`${sort.startsWith("-") ? "-" : ""}${COT_SAP_THEO_MOC[ky.moc]}`);
              }
              setLocMan({ ...locMan, ky });
            }}
            dieuKien={dieuKien}
            loc={locMan.loc}
            onLoc={(loc) => setLocMan({ ...locMan, loc })}
          />
          <LocNguoiPhuTrach
            nap={api.quotations.nguoiPhuTrach}
            value={nguoi}
            onChange={(v) => {
              setNguoi(v);
              setPage(1);
            }}
            donVi="BG"
          />
          <ChonCot cot={COT_BG} {...luoi.chonCot} />
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
                    {c.sx ? (
                      <TieuDeSapXep label={c.label} cot={c.key === "ngay" ? COT_SAP_THEO_MOC[mocNgay] : c.sx} sort={sort} onSort={setSort} />
                    ) : (
                      c.label
                    )}
                    {luoi.keo(c.key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 ? (
                <EmptyRow colSpan={cotHien.length} trangThai="dang-tai" />
              ) : listError ? (
                <tr>
                  <td colSpan={cotHien.length} className="lds-trong">
                    <span className="lds-do">{listError}</span>{" "}
                    <button type="button" className="lds-lk" onClick={() => load()}>
                      Thử lại
                    </button>
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={cotHien.length} className="lds-trong">
                    {!q.trim() && khoaLoc === "{}" && !statusFilter && nguoi == null
                      ? "Chưa có báo giá thương mại nào được tạo."
                      : "Không có báo giá nào khớp điều kiện đang lọc."}
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr
                    key={r.id}
                    className="lds-dong"
                    tabIndex={0}
                    onClick={() => openDetail(r)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        openDetail(r);
                      }
                    }}
                  >
                    {cotHien.map((c) => (
                      <OBaoGia
                        key={c.key}
                        cot={c.key}
                        r={r}
                        statuses={statuses}
                        mocNgay={mocNgay}
                        onMoDon={xemDon && navigate ? (id) => navigate("don-hang-ban", { openOrderId: id }) : undefined}
                      />
                    ))}
                  </tr>
                ))
              )}
              {/* Dòng Cộng: Σ giá bán của MỌI báo giá khớp bộ lọc (máy chủ cộng), không chỉ trang đang xem. */}
              {rows.length > 0 && viTriGia > 0 ? (
                <tr className="lds-cong lds-nhom">
                  <td className="lead" colSpan={viTriGia}>
                    <span className="lds-dinh-trai">Cộng {total.toLocaleString("vi-VN")} báo giá</span>
                  </td>
                  <td className="n">{soVN(tongGiaBan)}</td>
                  {cotHien.length - viTriGia - 1 > 0 ? <td colSpan={cotHien.length - viTriGia - 1} /> : null}
                </tr>
              ) : null}
            </tbody>
          </table>
        </CuonLuoi>
        {!listError && total > 0 && (
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
            donVi="báo giá"
            ariaLabel="Phân trang báo giá"
          />
        )}
      </div>
    </main>
  );
}

// --- Lưới danh sách (phương án A, 07/10/2026) --------------------------------------------------
// Thứ tự: Mã, Ngày, Khách, Sản phẩm, Giá bán, Lãi, Trạng thái, Người duyệt, Hiệu lực,
// Đơn hàng (chứng từ kế tiếp), Người lập. Cột Số lượng ĐÃ GỠ (13/10/2026): báo giá nhiều sản phẩm
// khác loại thì một con số SL của dòng đầu không nói lên gì — SL từng dòng xem trong báo giá.
const COT_BG: (CotLuoi & { w?: number; n?: boolean; sx?: string })[] = [
  { key: "ma", label: "Mã báo giá", coDinh: true, w: 140, sx: "code" },
  { key: "ngay", label: "Ngày tạo", w: 110, sx: "created_at" },
  { key: "khach", label: "Khách hàng", w: 200 },
  { key: "sp", label: "Sản phẩm", w: 195 },
  { key: "gia", label: "Giá bán gồm VAT", w: 130, n: true, sx: "total" },
  { key: "lai", label: "Lãi", w: 60, n: true },
  { key: "tt", label: "Trạng thái", w: 150, sx: "status" },
  { key: "duyet", label: "Người duyệt", w: 120 },
  { key: "han", label: "Hiệu lực", w: 100, sx: "valid_until" },
  { key: "don", label: "Đơn hàng", w: 90 },
  { key: "nguoi", label: "Người lập" },
];

// Chấm màu hàng lọc nhanh — cùng sắc với chip trạng thái của dòng (BADGE_TRANG_THAI).
const MAU_TRANG_THAI: Record<string, MauTT | undefined> = {
  need_action: "do",
  draft: "slate",
  pending_approval: "vang",
  approved: "xanh",
  sent: "cyan",
  accepted: "la",
  converted_to_order: "tim",
  rejected: "do",
  expired: "cam",
  cancelled: "xam",
};

const NHAN_DON: Record<string, string> = {
  draft: "Nháp",
  ordered: "Đã chốt",
  cancelled: "Hủy",
};

function OBaoGia({
  cot,
  r,
  statuses,
  mocNgay,
  onMoDon,
}: {
  cot: string;
  r: QuotationRow;
  statuses: EnumOption[];
  mocNgay: "tao" | "gui";
  onMoDon?: (orderId: number) => void;
}) {
  switch (cot) {
    case "ma":
      return (
        <td title={(r.version_count ?? 1) > 1 ? `${r.version_count} phiên bản` : undefined}>
          {r.code}
          <span className="lds-u">v{r.version}</span>
        </td>
      );
    case "ngay":
      return <td>{ngayVN(mocNgay === "gui" ? r.sent_at ?? null : r.created_at ?? null)}</td>;
    case "khach":
      return r.customer_name ? (
        <td title={r.customer_name}>{tenKhachGon(r.customer_name)}</td>
      ) : (
        <td className="lds-mu3">{r.customer_id != null ? `KH #${r.customer_id}` : "Chưa chọn khách"}</td>
      );
    case "sp": {
      const ten = r.san_pham ?? r.product_summary ?? null;
      return (
        <td title={r.product_summary ?? undefined}>
          {ten ?? <span className="lds-mu3">—</span>}
          {(r.so_sp_khac ?? 0) > 0 ? <span className="lds-tag">+{r.so_sp_khac}</span> : null}
        </td>
      );
    }
    case "gia":
      return <td className="n">{r.total != null ? soVN(r.total) : <span className="lds-mu3">—</span>}</td>;
    case "lai":
      return <td className="n">{r.margin_percent != null ? `${Math.round(r.margin_percent)}%` : <span className="lds-mu3">—</span>}</td>;
    case "tt": {
      // Tuổi phiếu: đã gửi N ngày chưa phản hồi → nhắc gọi lại khách (≥ 7 ngày tô đỏ).
      const sentDays =
        r.status === "sent" && r.sent_at ? Math.floor((Date.now() - new Date(r.sent_at).getTime()) / 86_400_000) : null;
      return (
        <td title={sentDays != null && sentDays >= 0 ? `Đã gửi ${sentDays} ngày chưa có phản hồi` : undefined}>
          <ChipTT mau={MAU_TRANG_THAI[r.status] ?? "slate"}>{labelOf(statuses, r.status)}</ChipTT>
          {sentDays != null && sentDays > 0 ? (
            <span className={`lds-u${sentDays >= 7 ? " lds-do" : ""}`}>{sentDays} ngày</span>
          ) : null}
        </td>
      );
    }
    case "duyet":
      return <ODuyetGon duyet={r.duyet} />;
    case "han":
      return <td>{ngayVN(r.valid_until)}</td>;
    case "don":
      return (
        <td title={r.don_hang_ma ? `${r.don_hang_ma}: ${NHAN_DON[r.don_hang_trang_thai ?? ""] ?? r.don_hang_trang_thai ?? ""}` : undefined}>
          {r.don_hang_ma ? (
            onMoDon && r.don_hang_id ? (
              <button
                type="button"
                className="lds-lk"
                onClick={(e) => {
                  e.stopPropagation();
                  onMoDon(r.don_hang_id!);
                }}
              >
                {r.don_hang_ma}
              </button>
            ) : (
              r.don_hang_ma
            )
          ) : (
            <span className="lds-mu3">—</span>
          )}
        </td>
      );
    case "nguoi":
      return <td>{r.salesperson_name ?? <span className="lds-mu3">—</span>}</td>;
    default:
      return <td />;
  }
}

// Ô "Người duyệt" một dòng. Chỉ báo giá ĐẶC THÙ phải qua duyệt — báo giá thường để gạch mờ (dòng nào
// cũng "Không cần duyệt" là nhiễu). Chờ duyệt: ai duyệt được; đã duyệt / từ chối: người quyết.
// Lúc quyết, ý kiến, danh sách người duyệt được nằm ở chú thích khi rê chuột.
function ODuyetGon({ duyet }: { duyet: QuotationRow["duyet"] }) {
  if (!duyet || duyet.trang_thai === "khong_can") {
    return <td className="lds-mu3" title={duyet ? "Không cần duyệt" : undefined}>—</td>;
  }
  const [dau, ...con] = duyet.nguoi;
  const luc =
    duyet.trang_thai === "cho"
      ? `Đang chờ từ ${fmtDate(duyet.luc)}`
      : duyet.trang_thai === "da_duyet"
        ? `Đã duyệt ${fmtDate(duyet.luc)}`
        : `Từ chối ${fmtDate(duyet.luc)}`;
  const chuThich = [
    luc,
    duyet.trang_thai === "cho" && duyet.nguoi.length > 1 ? `Ai trong số này duyệt cũng được:\n${duyet.nguoi.join("\n")}` : "",
    duyet.trang_thai !== "cho" ? duyet.y_kien ?? "" : "",
  ]
    .filter(Boolean)
    .join("\n");
  return (
    <td title={chuThich} className={duyet.trang_thai === "tu_choi" ? "lds-do" : duyet.trang_thai === "cho" ? "lds-vang" : undefined}>
      {duyet.trang_thai === "cho" ? "Chờ " : ""}
      {dau ?? "chưa có người duyệt"}
      {con.length > 0 ? <span className="lds-u">và {con.length} người</span> : null}
    </td>
  );
}

// Badge trạng thái — mỗi trạng thái MỘT sắc tươi (bộ chip chung --tt-*, 07/10/2026) để liếc là phân
// biệt; trước đó Chờ duyệt = Đã duyệt và Từ chối = Hết hạn = Đã huỷ cùng màu.
const BADGE_TRANG_THAI: Record<string, string> = {
  draft: "tt-slate",
  pending_approval: "tt-vang",
  approved: "tt-xanh",
  sent: "tt-cyan",
  accepted: "tt-la",
  converted_to_order: "tt-tim",
  rejected: "tt-do",
  expired: "tt-cam",
  cancelled: "tt-xam",
};
function statusBadgeVariant(status: string): string {
  return BADGE_TRANG_THAI[status] ?? "tt-slate";
}
function StatusPill({ status, statuses }: { status: string; statuses: EnumOption[] }) {
  return (
    <span className={`badge ${statusBadgeVariant(status)}`}>
      <span className="d" />
      {labelOf(statuses, status)}
    </span>
  );
}

// --- Detail 2-cột in-page (port "ý hệt" prototype inan5 02-bao-gia.html) ------------------------------------------------

// Feed Hoạt động: action (audit backend) → [icon, lớp màu chấm, nhãn tiếng Việt].
// Nhãn chỉ tả VIỆC, KHÔNG ghim vai ("Giám đốc KD duyệt") — vai thật đi kèm tên người thao tác,
// backend ghi theo hồ sơ ("Ban giám đốc · Giám đốc · Nguyễn Văn Giám", xem actor_display.py).
const ACT_META: Record<string, [LucideIcon, string, string]> = {
  create_quote: [Plus, "rust", "Tạo báo giá"],
  update_quote: [Pencil, "steel", "Cập nhật báo giá"],
  change_order: [GitBranch, "rust", "Tạo phiên bản mới"],
  transition_pending_approval: [ArrowUpFromLine, "amber", "Trình duyệt"],
  quote_exception_approved: [Check, "moss", "Duyệt báo giá đặc thù"],
  quote_exception_rejected: [X, "signal", "Từ chối duyệt"],
  transition_sent: [Send, "steel", "Gửi khách"],
  transition_accepted: [Check, "moss", "Khách hàng đồng ý"],
  transition_rejected: [X, "signal", "Khách hàng từ chối"],
  transition_expired: [AlertCircle, "ash", "Hết hiệu lực"],
  transition_cancelled: [Ban, "ash", "Hủy báo giá"],
  transition_converted_to_order: [ArrowRight, "moss", "Lên đơn hàng"],
  quote_attach_add: [Paperclip, "steel", "Đính kèm tài liệu"],
  quote_attach_delete: [X, "ash", "Xóa tài liệu đính kèm"],
  quote_item_image_set: [ImagePlus, "steel", "Đặt ảnh minh họa bản in"],
  quote_item_image_clear: [X, "ash", "Gỡ ảnh minh họa bản in"],
};

// Ngày + giờ cho feed Hoạt động ("ai làm gì · khi nào").
function fmtDateTime(v: string | null): string {
  if (!v) return "—";
  const dt = new Date(v);
  return isNaN(dt.getTime()) ? "—" : dt.toLocaleString("vi-VN", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

/** Node bảng báo giá: 1 nhóm gộp (in ra khách 1 dòng) hoặc 1 dòng lẻ. */
type NodeBaoGia =
  | { kind: "don"; key: string; it: QuoteItemDetail }
  | { kind: "nhom"; key: string; ten: string; members: QuoteItemDetail[] };

/** Gom dòng cùng nhãn `nhom`, giữ vị trí dòng ĐẦU của mỗi nhóm. Không nhãn = đứng riêng. */
function gomDongTheoNhom(items: QuoteItemDetail[]): NodeBaoGia[] {
  const out: NodeBaoGia[] = [];
  const viTri = new Map<string, number>();
  for (const it of items) {
    const nh = (it.nhom ?? "").trim();
    if (!nh) {
      out.push({ kind: "don", key: `d${it.id}`, it });
      continue;
    }
    const k = nh.toLowerCase();
    const at = viTri.get(k);
    if (at === undefined) {
      viTri.set(k, out.length);
      out.push({ kind: "nhom", key: k, ten: nh, members: [it] });
    } else {
      (out[at] as { members: QuoteItemDetail[] }).members.push(it);
    }
  }
  return out;
}



function QuotationDetailView({
  quotationId,
  statuses,
  navigate,
  onClose,
  onChanged,
}: {
  quotationId: number;
  statuses: EnumOption[];
  navigate?: (id: string, params?: any) => void;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { token } = useAuth();
  // Xuất PDF đối ngoại = ô THAO TÁC của Báo giá (05/10/2026) — khớp `quotations.py` /pdf.
  const canExport = useCan()("bao_gia", "update");
  // Tạo phiên bản mới (requote) + toàn bộ thao tác vòng đời THƯỜNG (gửi khách / từ chối / trình
  // duyệt) = ai SỬA được báo giá thì làm được (gộp vào `update` ở P8; quyền `requote` cũ đã bỏ).
  // Backend (`quotations.py` transition_quotation) cũng chỉ đòi `update`, KHÔNG đòi `manage_status`
  // — cột đó không có ô tick trên ma trận phân quyền nên chỉ 4 vai seed cứng có được, khiến nút
  // "Gửi khách" biến mất với mọi vai khác dù đã bật đủ quyền Kinh doanh (bug 26/08/2026).
  // State machine (`change_order`) vẫn chặn đúng trạng thái.
  const canRequote = useCan()("bao_gia", "update");
  // Lưu ý: layout 2 cột (main) không còn nút Hủy báo giá — quyền `cancel` vẫn chặn ở backend.
  // BG-2: duyệt "báo giá đặc thù" — CHỈ Giám đốc. Người có quyền này cũng thấy số markup.
  const canApproveException = useCan()("bao_gia", "approve_exception");
  // Lên đơn từ báo giá đã chốt → cần quyền TẠO ở module Đơn hàng bán (nút chỉ hiện khi có).
  const canCreateOrder = useCan()("don_hang_ban", "create");
  const [d, setD] = useState<QuotationDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [apprNote, setApprNote] = useState("");
  const [apprSaving, setApprSaving] = useState(false);

  // Số đang gõ dở (nháp, chưa lưu) theo từng dòng — bảng tính lại ngay. `ck` = chiết khấu, `ln` = lợi nhuận
  // (kiểu "pct" = % hoặc "so" = số tiền), `gia` = giá bán gõ tay. Dòng thuộc nhóm (ruột + bìa) gõ chiết
  // khấu ở dải nhóm: nháp đặt cho mọi dòng của nhóm.
  const [nhap, setNhap] = useState<Record<number, NhapDong>>({});
  // Diễn giải quy cách đang sửa: id dòng đang mở ô + nội dung gõ dở (lưu khi rời ô).
  const [dgOpen, setDgOpen] = useState<number | null>(null);
  const [dgDraft, setDgDraft] = useState<string>("");
  // Ảnh minh họa in cho khách: id dòng đang tải ảnh lên (khóa nút, hiện "Đang tải…") + ô xem lớn.
  const [anhBusy, setAnhBusy] = useState<number | null>(null);
  const [anhXem, setAnhXem] = useState<{ url: string; ten: string } | null>(null);

  const [compareOn, setCompareOn] = useState(false);
  const [showPrint, setShowPrint] = useState(false);

  // Điều khoản chỉnh tại chỗ (nháp) — 1 khối text, mỗi dòng = 1 điều khoản.
  const [termsText, setTermsText] = useState(DEFAULT_TERMS);
  const [validity, setValidity] = useState<number>(30);
  const [validUntilEdit, setValidUntilEdit] = useState<string>("");   // ngày hết hạn (editable)
  const [verNote, setVerNote] = useState("");

  // Feed Hoạt động — nhật ký tương tác THẬT (ai làm gì) đọc từ backend.
  const [acts, setActs] = useState<QuotationActivity[]>([]);
  // Tạo phiên bản mới: BẮT BUỘC ghi chú → modal nhập lý do trước khi tạo.
  const [requoteOpen, setRequoteOpen] = useState(false);
  const [requoteNote, setRequoteNote] = useState("");
  // Khách chốt MỘT PHẦN: picker chọn dòng khách ưng trước khi ghi "Khách chốt". Mặc định tick hết
  // (case phổ biến = ưng cả) → 1 lần bấm là xong; bỏ tick dòng khách không lấy.
  const [acceptOpen, setAcceptOpen] = useState(false);
  const [acceptPicks, setAcceptPicks] = useState<Record<number, boolean>>({});

  const reload = useCallback(
    async (id: number) => {
      if (!token) return;
      // Nhật ký Hoạt động tải SONG SONG với chi tiết, không đợi chi tiết xong mới gọi.
      api.quotations.activity(token, id).then((r) => setActs(r.items)).catch(() => setActs([]));
      try {
        const det = await api.quotations.get(token, id);
        setD(det);
        setNhap({});
        setTermsText(det.terms_text ?? DEFAULT_TERMS);
        setVerNote((det as any).change_reason ?? "");
        setValidUntilEdit(det.valid_until ?? "");
        // Hiệu lực (ngày) suy từ valid_until so với ngày tạo bản hiện tại.
        const vr = det.versions.find((v) => v.version === det.version);
        const created = vr?.created_at ?? null;
        if (det.valid_until && created) {
          const days = Math.round(
            (new Date(det.valid_until).getTime() - new Date(created).getTime()) / 86_400_000,
          );
          setValidity(days > 0 ? days : 30);
        } else setValidity(30);
      } catch {
        setErr("Không tải được chi tiết báo giá.");
      }
    },
    [token],
  );

  useEffect(() => {
    reload(quotationId);
  }, [reload, quotationId]);

  if (!d) {
    return (
      <main className="rdx-quote bgv">
        <div className="panel">
          <EmptyState trangThai="dang-tai" inline nhanTai="Đang tải dữ liệu báo giá…" />
        </div>
      </main>
    );
  }

  const latestVer = Math.max(...d.versions.map((v) => v.version));
  const viewingLatest = d.version === latestVer;
  const editable = d.status === "draft" && viewingLatest;
  const multi = d.items.length > 1;

  // ---- Tính toán sống (áp số đang gõ nếu có) -------------------------------
  // Giá bán = giá vốn + tiền chiết khấu + tiền lợi nhuận. Chiết khấu % tính trên giá vốn; lợi nhuận %
  // tính trên (giá vốn + chiết khấu). Khớp backend `calculate_pricing`.
  function calcItem(it: QuoteItemDetail) {
    const cost = it.total_cost_snapshot;
    const n = nhap[it.id];
    const lam = Math.round;
    const ck = n?.ck
      ? lam(n.ck.k === "pct" ? (cost * Math.max(0, n.ck.v)) / 100 : Math.max(0, n.ck.v))
      : it.discount_amount;
    const goc = cost + ck;
    let selling: number;
    if (n?.gia != null) selling = n.gia;                                   // giá gõ tay: lợi nhuận là phần còn lại
    else if (n?.ln) selling = goc + lam(n.ln.k === "pct" ? (goc * Math.max(0, n.ln.v)) / 100 : Math.max(0, n.ln.v));
    else if (n?.ck && !it.gia_go_tay) selling = goc + lam((goc * it.margin_percent) / 100);   // đổi chiết khấu: lợi nhuận giữ %
    else selling = it.selling_price;                                       // số đã lưu (dòng gõ tay giữ giá)
    const ln = selling - goc;
    const vat = (selling * (it.vat_percent || 0)) / 100;
    return {
      m: goc > 0 ? (ln / goc) * 100 : 0, cost, ck, disc: ck, goc, ln, selling, net: selling, vat,
      final: selling + vat, profit: ln, qty: it.quantity,
    };
  }
  let costT = 0, sellingT = 0, netT = 0, vatT = 0, grandT = 0, discountT = 0, profitT = 0;
  d.items.forEach((it) => {
    const c = calcItem(it);
    costT += c.cost; sellingT += c.selling; netT += c.net; vatT += c.vat; grandT += c.final;
    discountT += c.ck; profitT += c.ln;
  });
  const pctf = (v: number) => (Math.round(v * 10) / 10).toLocaleString("vi-VN");
  const singleVat = d.items[0]?.vat_percent ?? 10;
  // Markup hiển thị = tổng lợi nhuận / (giá vốn + chiết khấu) — cùng gốc với ô Markup từng dòng.
  const markupPctDisp = costT + discountT > 0 ? Math.round((profitT / (costT + discountT)) * 100) : 0;

  // Tên tóm tắt: dòng đầu thuộc nhóm thì lấy TÊN NHÓM (khách mua "quyển sách", không mua "ruột").
  const productSummary = d.items[0]?.nhom?.trim() || d.items[0]?.product_name || "—";

  // ---- Persist margin/VAT --------------------------------------------------
  // Patch theo dòng: bỏ trống field nào thì GIỮ giá trị hiện tại của dòng đó (dùng ?? để 0 vẫn áp).
  // Header lấy từ edit-state (không clobber ghi chú/điều khoản đang sửa chưa lưu).
  async function persistItems(
    items: { id: number; margin_percent?: number; manual_selling_price?: number | null; vat_percent?: number; discount_amount?: number; discount_percent?: number; profit_amount?: number; rounding?: string; note?: string | null; dien_giai?: string | null }[],
  ) {
    if (!token || !d) return;
    setBusy(true);
    setErr(null);
    try {
      // Khách / điểm giao / người nhận / ghi chú nội bộ KẾ THỪA từ phiếu tính giá — không gửi.
      await api.quotations.update(token, d.id, {
        valid_until: validUntilEdit || null,
        terms_text: termsText,
        items: d.items.map((it) => {
          const patch = items.find((x) => x.id === it.id);
          return {
            id: it.id,
            margin_percent: patch?.margin_percent ?? it.margin_percent,
            // Giá gõ tay: dòng đang gõ thì gửi số mới; sửa Markup (patch có % hoặc số tiền, không kèm
            // giá) là về theo markup; dòng KHÔNG đụng tới mà đang gõ tay thì giữ nguyên giá đã gõ (để
            // đổi VAT/chiết khấu không làm rơi giá gõ tay của nó).
            manual_selling_price:
              patch?.manual_selling_price !== undefined
                ? patch.manual_selling_price
                : patch?.margin_percent !== undefined || patch?.profit_amount !== undefined
                  ? undefined
                  : it.gia_go_tay
                    ? it.selling_price
                    : undefined,
            // Chiết khấu gõ theo % thì gửi % (tiền = 0 để % thắng); còn lại gửi tiền đã lưu.
            discount_amount: patch?.discount_percent !== undefined ? 0 : (patch?.discount_amount ?? it.discount_amount),
            discount_percent: patch?.discount_percent ?? 0,
            profit_amount: patch?.profit_amount,
            vat_percent: patch?.vat_percent ?? it.vat_percent,
            rounding: patch?.rounding ?? "no_rounding",
            note: patch?.note !== undefined ? patch.note : it.note,
            // Payload dump đủ field ở BE → phải echo giá trị cũ, không gửi = XOÁ diễn giải.
            dien_giai: patch?.dien_giai !== undefined ? patch.dien_giai : it.dien_giai,
          };
        }),
      });
      await reload(d.id);
      onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Không lưu được giá bán.");
    } finally {
      setBusy(false);
    }
  }
  /** Chia số tiền gõ cho CẢ NHÓM (ruột + bìa) về từng dòng theo tỷ lệ `trong` — dòng cuối nhận phần dư
   *  để tổng đúng từng đồng. */
  function chiaTheoTyLe(dong: QuoteItemDetail[], tong: number, trong: (it: QuoteItemDetail) => number): number[] {
    const tat = dong.reduce((s, it) => s + trong(it), 0);
    let con = Math.round(tong);
    return dong.map((it, i) => {
      const phan = i === dong.length - 1 ? con : Math.min(con, Math.round(tat > 0 ? (tong * trong(it)) / tat : tong / dong.length));
      con -= phan;
      return phan;
    });
  }
  /** Chốt chiết khấu của MỘT sản phẩm khách thấy (dòng riêng hoặc cả nhóm): % áp cho từng dòng trên giá
   *  vốn của nó; số tiền chia cho các dòng theo giá vốn. */
  function commitChietKhau(dong: QuoteItemDetail[], kieu: Kieu, v: number) {
    if (!editable || !d) return;
    if (kieu === "pct") {
      const p = Math.max(0, Math.min(100, v));
      persistItems(dong.map((it) => ({ id: it.id, discount_percent: p })));
    } else {
      const phan = chiaTheoTyLe(dong, Math.max(0, v), (it) => it.total_cost_snapshot);
      persistItems(dong.map((it, i) => ({ id: it.id, discount_amount: phan[i] })));
    }
  }
  /** Chốt lợi nhuận (Markup) của một dòng: % trên (vốn + chiết khấu) hoặc số tiền. Sửa Markup bỏ giá gõ tay. */
  function commitLoiNhuan(it: QuoteItemDetail, kieu: Kieu, v: number) {
    if (!editable || !d) return;
    persistItems([kieu === "pct"
      ? { id: it.id, margin_percent: Math.max(0, Math.min(1000, v)) }
      : { id: it.id, margin_percent: it.margin_percent, profit_amount: Math.max(0, Math.round(v)) }]);
  }
  /** Giá bán GÕ TAY — làm gốc; chiết khấu giữ nguyên, lợi nhuận là phần còn lại. */
  function commitGia(it: QuoteItemDetail, val: number) {
    if (!editable || !d) return;
    persistItems([{ id: it.id, manual_selling_price: Math.max(0, val) }]);
  }
  /** Bỏ giá gõ tay của dòng, về tính theo markup (làm tròn markup đang suy ra từ giá gõ tay). */
  function veTheoMarkup(it: QuoteItemDetail) {
    if (!editable) return;
    const c = calcItem(it);
    setNhap((p) => { const n = { ...p }; delete n[it.id]; return n; });
    persistItems([{ id: it.id, margin_percent: Math.max(0, Math.round(c.m)) }]);
  }
  /** Đặt ảnh minh họa (in ở cột "Hình ảnh minh họa" bản gửi khách) cho CỤM chứa dòng này.
   *  Backend ghi cho mọi dòng cùng tên — sản phẩm cùng tên chỉ cần upload MỘT lần. */
  async function datAnhMinhHoa(itemId: number, file: File) {
    if (!token || !d) return;
    setAnhBusy(itemId);
    setErr(null);
    try {
      await api.quotations.uploadItemImage(token, d.id, itemId, file);
      await reload(d.id);
      onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Không tải được ảnh minh họa.");
    } finally {
      setAnhBusy(null);
    }
  }
  async function xoaAnhMinhHoa(itemId: number) {
    if (!token || !d) return;
    setAnhBusy(itemId);
    setErr(null);
    try {
      await api.quotations.deleteItemImage(token, d.id, itemId);
      await reload(d.id);
      onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Không xóa được ảnh minh họa.");
    } finally {
      setAnhBusy(null);
    }
  }

  /** Ô ảnh minh họa của MỘT cụm in. Đặt ở dải nhóm (cụm ruột+bìa) hoặc ở dòng đứng riêng — đúng
   *  một chỗ cho mỗi dòng sẽ in ra khách, vì cả cụm chỉ có MỘT ảnh. */
  function oAnhCum(it: QuoteItemDetail, ten: string) {
    const url = assetUrl(it.anh_minh_hoa);
    const dangTai = anhBusy === it.id;
    return (
      <div className="qanh">
        {url ? (
          <>
            <button
              type="button"
              className="qanh__thumb"
              onClick={() => setAnhXem({ url, ten })}
              title="Xem ảnh lớn"
            >
              <img src={anhNho(it.anh_minh_hoa) ?? url} alt={`Ảnh minh họa ${ten}`} />
            </button>
            {canRequote && (
              <button
                type="button"
                className="qanh__go"
                disabled={dangTai}
                onClick={() => xoaAnhMinhHoa(it.id)}
              >
                {dangTai ? "Đang xóa…" : "Xóa ảnh"}
              </button>
            )}
          </>
        ) : canRequote ? (
          <label className={`qanh__them${dangTai ? " is-busy" : ""}`}>
            <ImagePlus size={13} />
            {dangTai ? "Đang tải…" : "Thêm ảnh minh họa"}
            <input
              type="file"
              accept="image/*"
              disabled={dangTai}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";     // chọn lại đúng file vừa lỗi vẫn kích hoạt onChange
                if (f) datAnhMinhHoa(it.id, f);
              }}
            />
          </label>
        ) : null}
      </div>
    );
  }

  /** Lưu diễn giải quy cách của 1 dòng (rời ô mới lưu). Không đổi thì bỏ qua — khỏi ghi nhật ký thừa. */
  function commitDienGiai(itemId: number) {
    setDgOpen(null);
    if (!editable || !d) return;
    const cur = d.items.find((it) => it.id === itemId)?.dien_giai ?? "";
    const next = dgDraft.trim();
    if (next === cur.trim()) return;
    persistItems([{ id: itemId, dien_giai: next || null }]);
  }
  // VAT áp CHUNG mọi dòng, kể cả báo giá nhiều dòng (VN chuẩn 0/5/8/10%).
  function commitVat(val: number) {
    if (!editable || !d) return;
    const v = Math.max(0, Math.min(100, val));
    persistItems(d.items.map((it) => ({ id: it.id, vat_percent: v })));
  }
  /** Nháp của một ô (đang gõ) cho mọi dòng `ids`; `v == null` = bỏ nháp. */
  function datNhap(ids: number[], khoa: "ck" | "ln" | "gia", v: { k: Kieu; v: number } | number | null) {
    setNhap((p) => {
      const n = { ...p };
      ids.forEach((id) => {
        const cu = { ...(n[id] ?? {}) } as NhapDong;
        if (v == null) delete cu[khoa]; else (cu as Record<string, unknown>)[khoa] = v;
        if (Object.keys(cu).length) n[id] = cu; else delete n[id];
      });
      return n;
    });
  }
  /** Ô CHIẾT KHẤU của MỘT sản phẩm khách thấy (dòng đứng riêng hoặc cả nhóm): hai tab "%" và "Số". */
  function oChietKhau(dong: QuoteItemDetail[], ten: string) {
    const von = dong.reduce((s, it) => s + calcItem(it).cost, 0);
    const ck = dong.reduce((s, it) => s + calcItem(it).ck, 0);
    const pct = von > 0 ? (ck / von) * 100 : 0;
    const ids = dong.map((it) => it.id);
    if (!editable) return ck > 0 ? `${numf(ck)} đ (${pctf(pct)} %)` : "—";
    return (
      <OHaiTab
        pct={Math.round(pct * 10) / 10}
        so={ck}
        disabled={busy}
        ariaLabel={`Chiết khấu ${ten}`}
        titlePct="Chiết khấu (%) trên giá vốn — cộng vào giá bán, hoàn lại khách sau"
        titleSo="Tiền chiết khấu — cộng vào giá bán, hoàn lại khách sau"
        onNhap={(k, v) => datNhap(ids, "ck", { k, v })}
        onHuy={() => datNhap(ids, "ck", null)}
        onChot={(k, v) => commitChietKhau(dong, k, v)}
      />
    );
  }


  async function saveTerms() {
    if (!token || !d) return;
    setBusy(true);
    setErr(null);
    try {
      await api.quotations.update(token, d.id, {
        valid_until: validUntilEdit || null,
        terms_text: termsText,
        items: null,
      });
      await reload(d.id);
      onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Lưu nháp thất bại.");
    } finally {
      setBusy(false);
    }
  }

  async function doTransition(to: string) {
    if (!token || !d) return;
    setBusy(true);
    setErr(null);
    try {
      await api.quotations.transition(token, d.id, { to_status: to, cancel_reason: null });
      await reload(d.id);
      onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Thao tác không thành công.");
    } finally {
      setBusy(false);
    }
  }

  // Khách chốt: mở picker chọn dòng khách ưng (mặc định tick hết). 1 dòng thì khỏi hỏi — chốt luôn.
  function openAcceptPicker() {
    if (!d) return;
    if (d.items.length <= 1) { void doAccept(d.items.map((it) => it.id)); return; }
    setAcceptPicks(Object.fromEntries(d.items.map((it) => [it.id, true])));
    setErr(null);
    setAcceptOpen(true);
  }

  // Ghi "Khách chốt" kèm danh sách dòng khách ƯNG (khách chốt một phần). Đơn hàng sau chỉ kéo dòng này.
  async function doAccept(ids: number[]) {
    if (!token || !d) return;
    if (ids.length === 0) { setErr("Chọn ít nhất 1 sản phẩm khách chốt."); return; }
    setBusy(true);
    setErr(null);
    try {
      await api.quotations.transition(token, d.id, { to_status: "accepted", accepted_item_ids: ids });
      setAcceptOpen(false);
      await reload(d.id);
      onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Thao tác không thành công.");
    } finally {
      setBusy(false);
    }
  }

  // Khách đã chốt (accepted) → lên đơn hàng bán từ CHÍNH báo giá này (BE kéo dòng/giá/cọc; guard
  // 1 báo giá → 1 đơn). Xong điều hướng sang màn Đơn hàng bán, mở luôn đơn vừa tạo.
  /** Phiếu tính giá đã đổi SL / giá vốn / sản phẩm: nháp thì cập nhật tại chỗ, đã gửi thì máy chủ
   * tạo phiên bản mới — cả hai giữ markup, giá gõ tay, chiết khấu, diễn giải từng dòng. */
  async function capNhatTheoPhieu() {
    if (!token || !d?.phieu_tinh_gia_id) return;
    setBusy(true);
    setErr(null);
    try {
      await api.quotations.resyncFromPhieu(token, d.phieu_tinh_gia_id);
      await reload(d.id);
      onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Không cập nhật được theo phiếu tính giá.");
    } finally {
      setBusy(false);
    }
  }

  async function createOrderFromQuote() {
    if (!token || !d) return;
    setBusy(true);
    setErr(null);
    try {
      const order = await api.orders.create(token, { quotation_id: d.id });
      navigate?.("don-hang-ban", { openOrderId: order.id });
    } catch (e) {
      // BE trả 409 khi báo giá đã có đơn (message rõ) → hiện nguyên văn.
      setErr(e instanceof ApiError ? e.message : "Không tạo được đơn hàng từ báo giá này.");
    } finally {
      setBusy(false);
    }
  }

  async function submitQuoteApproval(decision: "approved" | "rejected") {
    if (!token || !d) return;
    if (!apprNote.trim()) {
      setErr("Nhập lý do/ý kiến — bắt buộc khi duyệt HOẶC từ chối báo giá đặc thù.");
      return;
    }
    setApprSaving(true);
    setErr(null);
    try {
      await api.quotations.recordApproval(token, d.id, { decision, note: apprNote.trim() || null });
      setApprNote("");
      await reload(d.id);
      onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Ghi duyệt không thành công.");
    } finally {
      setApprSaving(false);
    }
  }

  function openRequote() {
    setRequoteNote("");
    setErr(null);
    setRequoteOpen(true);
  }
  async function doRequote() {
    if (!token || !d) return;
    const note = requoteNote.trim();
    if (!note) { setErr("Nhập lý do/ghi chú cho phiên bản mới — bắt buộc."); return; }
    setBusy(true);
    setErr(null);
    try {
      const nv = await api.quotations.requote(token, d.id, note);
      setRequoteOpen(false);
      setRequoteNote("");
      setD(null);
      await reload(nv.id);
      onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Tạo phiên bản mới không thành công.");
    } finally {
      setBusy(false);
    }
  }



  const marginPctDisp = markupPctDisp;
  const meterW = Math.max(0, Math.min(100, marginPctDisp));

  // Khách chốt một phần: chỉ đánh dấu "khách không lấy" khi báo giá ĐÃ chốt VÀ có ít nhất 1 dòng được
  // ưng (phân biệt với báo giá cũ chốt-toàn-phần: accepted toàn false → coi như lấy hết, không gạch).
  const quoteClosed = d.status === "accepted" || d.status === "converted_to_order";
  const acceptedDecided = d.items.some((it) => it.accepted);
  // Cây hiển thị của bảng: dòng cùng nhãn `nhom` kéo về cạnh nhau dưới 1 dải, tại vị trí dòng đầu.
  // KHÔNG bọc useMemo: chỗ này nằm sau một `return` sớm của component → thêm hook ở đây là đổi
  // thứ tự hook giữa các lần render (React văng). Danh sách vài dòng, tính thẳng rẻ hơn nhiều.
  const nhomTrongBaoGia = gomDongTheoNhom(d.items);
  // Nhóm gộp có các dòng lệch SL → bản in TÁCH chúng ra, phải nhắc người soạn biết trước.
  const nhomLech = nhomLechSoLuong(d.items, (it) => ({
    nhom: it.nhom, ten: it.product_name, soLuong: it.quantity, donViTinh: it.unit,
    thanhTien: 0, tienVat: 0, vatPct: it.vat_percent,
  }));

  return (
    <main className="rdx-quote bgv">
      {/* ---------- Header ---------- */}
      <div className="dhead">
        <div>
          <button type="button" className="back" onClick={onClose}><ChevronLeft size={15} /> Danh sách</button>
          <div className="titleline">
            <h1>{d.code}</h1>
            <span className="ver">v{d.version}</span>
            <StatusPill status={d.status} statuses={statuses} />
          </div>
          {/* Khách đã có ở dải ngay dưới — dòng phụ chỉ còn tên hàng + NV soạn. */}
          <div className="subline">
            <span>{productSummary}</span>
            {d.salesperson_name ? <span className="tag">NV soạn {d.salesperson_name}</span> : null}
          </div>
        </div>
        <div className="acts">
          <Button variant="secondary" onClick={() => setShowPrint(true)}><Printer size={15} /> Xem bản in</Button>
          {/* Gating quyền: từ chối/trình duyệt/gửi là thao tác THƯỜNG, backend chỉ đòi `update`
              (quotations.py transition_quotation) — dùng `canRequote` (= can_update) cho khớp,
              KHÔNG dùng `manage_status` (cột đó không có ô tick nào trên ma trận phân quyền nên
              không vai nào ngoài 4 vai seed cứng bật được, khiến nút biến mất — bug 26/08/2026).
              Khách chốt cũng vậy: trước 05/10/2026 nút này gác bằng cờ `approve` — cột không có ô
              nào trên ma trận Báo giá, nên chỉ vai Giám đốc seed cứng thấy nút dù máy chủ chỉ đòi
              `update`. Bài học 26/08 lặp lại; giờ cả hai nút cùng một cờ. */}
          {viewingLatest && d.status === "sent" && canRequote && (
            <>
              <Button variant="secondary" disabled={busy} onClick={() => doTransition("rejected")}><X size={15} /> Khách từ chối</Button>
              <Button variant="primary" disabled={busy || !d.allowed_transitions.includes("accepted")} onClick={openAcceptPicker}><Check size={15} /> Khách chốt</Button>
            </>
          )}
          {/* Nháp: báo giá ĐẶC THÙ phải TRÌNH DUYỆT (→ Chờ duyệt → GĐ Kinh doanh duyệt); báo giá
              THƯỜNG gửi khách thẳng. Backend chặn cứng 2 đường (redesign-bao-gia §3). */}
          {canRequote && viewingLatest && d.status === "draft" && d.exception_required &&
            d.allowed_transitions.includes("pending_approval") && (
            <Button
              variant="accent"
              disabled={busy || !d.customer_id}
              title={!d.customer_id ? "Vui lòng chọn khách hàng trước" : "Báo giá đặc thù — trình duyệt trước khi gửi khách"}
              onClick={() => doTransition("pending_approval")}
            ><ArrowUpFromLine size={15} /> Trình duyệt</Button>
          )}
          {/* Gửi khách (SALE tự gửi): báo giá THƯỜNG từ Nháp, HOẶC đặc thù ĐÃ ĐƯỢC GĐ DUYỆT (approved). */}
          {canRequote && viewingLatest && d.allowed_transitions.includes("sent") &&
            ((d.status === "draft" && !d.exception_required) || d.status === "approved") && (
            <Button
              variant="accent"
              disabled={busy || !d.customer_id}
              title={!d.customer_id ? "Vui lòng chọn khách hàng trước" : (d.status === "approved" ? "Giám đốc đã duyệt — gửi báo giá cho khách" : undefined)}
              onClick={() => doTransition("sent")}
            ><Send size={15} /> Gửi khách</Button>
          )}
          {canRequote && viewingLatest && d.status === "rejected" && d.allowed_transitions.includes("change_order") && (
            <Button variant="primary" disabled={busy} onClick={openRequote}><GitBranch size={15} /> Tạo phiên bản mới</Button>
          )}
          {/* Báo giá ĐÃ có đơn (1 báo giá → 1 đơn) → liên kết sang đơn, KHÔNG cho tạo nữa. */}
          {d.order_id != null && (
            <Button variant="secondary" onClick={() => navigate?.("don-hang-ban", { openOrderId: d.order_id })}>
              <ArrowRight size={15} /> Xem đơn hàng{d.order_no ? ` ${d.order_no}` : ""}
            </Button>
          )}
          {/* Khách đã chốt & CHƯA có đơn → lên đơn hàng bán từ báo giá này. */}
          {canCreateOrder && d.status === "accepted" && d.order_id == null && (
            <Button variant="primary" disabled={busy} onClick={createOrderFromQuote}><ArrowRight size={15} /> Tạo đơn hàng</Button>
          )}
        </div>
      </div>

      {err && (
        <div className="banner banner--error" role="alert" style={{ marginBottom: "14px" }}>{err}</div>
      )}
      {/* Phiếu tính giá nguồn đã đổi số so với bản đang xem. Nháp tự theo khi lưu phiếu, nên băng
          này chủ yếu hiện ở báo giá đã gửi (khách đang cầm số cũ) và nháp lập trước 05/10/2026. */}
      {d.phieu_doi && viewingLatest && (
        <div className="banner banner--warn" role="status" style={{ marginBottom: "14px", alignItems: "center" }}>
          <span>
            Phiếu tính giá {d.phieu_tinh_gia_ma ?? ""} đã đổi số lượng hoặc giá vốn so với báo giá này.
            {d.status === "draft" ? "" : " Khách đang cầm bản cũ — cập nhật sẽ tạo phiên bản mới, bản cũ giữ nguyên trong lịch sử."}
          </span>
          {canRequote && (
            <Button variant="secondary" disabled={busy} onClick={capNhatTheoPhieu}>
              <RefreshCw size={14} /> {d.status === "draft" ? "Cập nhật theo phiếu" : "Tạo phiên bản mới theo phiếu"}
            </Button>
          )}
        </div>
      )}
      {/* Báo giá BỊ TỪ CHỐI (khách HOẶC GĐ/TP từ chối đặc thù) → nhắc "Tạo phiên bản mới" để sửa. */}
      {d.status === "rejected" && (
        <div className="banner banner--error" role="alert" style={{ marginBottom: "14px" }}>
          {d.exception_decision === "rejected" ? (
            <span>Giám đốc/Trưởng phòng KD đã <b>từ chối</b> báo giá đặc thù{d.exception_note ? `: ${d.exception_note}` : ""}. Bấm <b>Tạo phiên bản mới</b> để sửa rồi trình duyệt lại.</span>
          ) : (
            <span><b>Khách hàng từ chối</b>{d.cancel_reason ? `: ${d.cancel_reason}` : ""}. Bấm <b>Tạo phiên bản mới</b> để báo lại giá mới.</span>
          )}
        </div>
      )}

      <DaiKhachHang
        giaTri={{
          customer_id: d.customer_id,
          customer_name: d.customer?.name ?? null,
          delivery_address: d.delivery_address,
          contact_name_snapshot: d.contact_name_snapshot,
          contact_phone_snapshot: d.contact_phone_snapshot,
          contact_title_snapshot: d.contact_title_snapshot,
          contact_email_snapshot: d.contact_email_snapshot,
        }}
        ghiChu={d.internal_note}
        phuKhach={d.customer?.tax_code ? `MST ${d.customer.tax_code}` : null}
        chan={
          <>
            <Lock size={13} aria-hidden="true" />
            <span>Lấy từ phiếu tính giá</span>
            {d.phieu_tinh_gia_id ? (
              <button
                type="button"
                className="dkh__chip"
                onClick={() => navigate?.("tinh-gia", { focusPhieuId: d.phieu_tinh_gia_id ?? undefined })}
                title="Mở phiếu tính giá nguồn"
              >
                <CornerDownLeft size={13} /> {d.phieu_tinh_gia_ma ?? `#${d.phieu_tinh_gia_id}`}
              </button>
            ) : null}
            <span className="dkh__sp" />
            {d.customer?.credit_status_display ? (
              <span className="dkh__tag">Tín dụng: {d.customer.credit_status_display}</span>
            ) : null}
            {/* Link "Sửa ở phiếu tính giá" đã gỡ (05/10/2026) — chip mã phiếu bên trái mở cùng chỗ. */}
          </>
        }
      />

      <div className="g2">
        {/* ================= LEFT: bảng + điều khoản ================= */}
        <div className="stack">
          {/* Báo giá nhiều dòng — giá vốn khóa, markup + chiết khấu chỉnh tại chỗ */}
          <div className="panel">
            <div className="panel__hd">
              <h3><Table size={16} /> {multi ? "Báo giá nhiều dòng" : "Giá vốn"}</h3>
              {/* Đếm DÒNG, không phải phiếu — 1 phiếu tính giá đẻ nhiều dòng là chuyện thường. */}
              <span className="tag">{multi ? `${d.items.length} dòng` : "Khóa từ PTG"}</span>
            </div>
            {/* Bản in gộp các phần cùng SL thành một cụm, rồi xếp các cụm cùng tên thành nhiều
                MỨC trong một dòng (`utils/gop-nhom`). Lệch SL thường là khai nhầm (bìa 1.000 /
                ruột 500) → nêu THẲNG phần nào bao nhiêu + sẽ in ra mấy mức. */}
            {nhomLech.length > 0 && (
              <div className="hint hint--warn hint--lechnhom" role="status">
                <TriangleAlert size={15} />
                <div className="lechnhom">
                  {nhomLech.map((n) => (
                    <div key={n.ten} className="lechnhom__item">
                      <div className="lechnhom__ten">«{n.ten}» — các phần lệch số lượng:</div>
                      <ul className="lechnhom__ds">
                        {n.phan.map((p, i) => (
                          <li key={i}>
                            {p.ten}: <b>{p.soLuong.toLocaleString("vi-VN")}</b>
                            {p.donViTinh ? ` ${p.donViTinh}` : ""}
                          </li>
                        ))}
                      </ul>
                      <div className="lechnhom__ket">
                        Chỉ các phần cùng số lượng mới gộp chung, nên bản gửi khách sẽ in nhãn này
                        thành <b>1</b> dòng với <b>{n.soDongSeIn}</b> mức số lượng. Kiểm lại trước
                        khi gửi.
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {/* `bg-dong`: thẻ điện thoại (components/luoiThe.ts) nhận diện bảng dòng hàng của báo giá. */}
            {/* Khung cuộn ngang dự phòng: có chiết khấu thì bảng 7 cột, màn hẹp vẫn xem đủ cột cuối. */}
            <div className="bg-dong-cuon">
            <table className="bg-dong">
              <thead>
                <tr>
                  {/* Giá bán = giá vốn + chiết khấu + lợi nhuận: các cột đi đúng thứ tự công thức. */}
                  <th>Sản phẩm</th><th className="num">SL</th><th className="num">Giá vốn</th>
                  <th className="num">Chiết khấu</th>
                  <th className="num">Markup</th>
                  <th className="num">Giá bán</th>
                </tr>
              </thead>
              <tbody>
                {/* Dải NHÓM: các dòng cùng nhãn in ra khách thành 1 dòng, nên bày chúng dưới một
                    dải mang đúng con số khách thấy. Markup vẫn nằm ở TỪNG dòng con. */}
                {nhomTrongBaoGia.flatMap((node) => {
                  const dongIt = (it: QuoteItemDetail, con: boolean, cuoi = false, slDauNhom?: number) => {
                  const c = calcItem(it);
                  const priceVal = nhap[it.id]?.gia ?? c.selling;
                  const priceOverridden = nhap[it.id]?.gia != null || it.gia_go_tay;
                  const declined = quoteClosed && acceptedDecided && !it.accepted;
                  // Dòng con có SL khác PHẦN ĐẦU nhóm → bản in in số phần đầu, không in số này. Đánh dấu.
                  const lechNhom = slDauNhom !== undefined && it.quantity !== slDauNhom;
                  return (
                    <tr
                      key={it.id}
                      className={
                        `${declined ? "declined" : ""}${con ? " qrow--con" : ""}${cuoi ? " qrow--conCuoi" : ""}${lechNhom ? " qrow--lech" : ""}`
                          .trim() || undefined
                      }
                    >
                      <td>
                        <span className="pname">{it.product_name}</span>
                        {declined && <span className="declined-badge">Khách không lấy</span>}
                        {/* Diễn giải quy cách IN cho khách — máy bung từ bài tính giá, sửa tại chỗ. */}
                        {dgOpen === it.id ? (
                          <textarea
                            className="dg-ta"
                            autoFocus
                            rows={4}
                            value={dgDraft}
                            placeholder={"Mỗi dòng 1 ý, ví dụ:\nKT: 350×215mm\nGiấy kraft 200g\nIn 1 màu"}
                            onChange={(e) => setDgDraft(e.target.value)}
                            onBlur={() => commitDienGiai(it.id)}
                            onKeyDown={(e) => { if (e.key === "Escape") setDgOpen(null); }}
                          />
                        ) : it.dien_giai ? (
                          <ul className="dg-list">
                            {it.dien_giai.split("\n").filter(Boolean).map((ln, k) => <li key={k}>{ln}</li>)}
                            {editable && (
                              <li className="dg-edit">
                                <button type="button" onClick={() => { setDgDraft(it.dien_giai ?? ""); setDgOpen(it.id); }}>
                                  Sửa diễn giải
                                </button>
                              </li>
                            )}
                          </ul>
                        ) : editable ? (
                          <button
                            type="button"
                            className="dg-add"
                            onClick={() => { setDgDraft(""); setDgOpen(it.id); }}
                          >
                            + Thêm diễn giải
                          </button>
                        ) : null}
                        {/* Dòng thuộc cụm thì ảnh đã treo ở dải nhóm phía trên — không lặp lại. */}
                        {!con && oAnhCum(it, it.product_name)}
                      </td>
                      <td className="num">
                        {it.quantity.toLocaleString("vi-VN")}
                        {lechNhom && (
                          <span className="ql-lech" title={`Phần đầu nhóm là ${slDauNhom!.toLocaleString("vi-VN")} — bản in gửi khách lấy số này`}>
                            ⚠ lệch phần đầu ({slDauNhom!.toLocaleString("vi-VN")})
                          </span>
                        )}
                      </td>
                      <td className="num muted">{numf(c.cost)}</td>
                      {/* Phần con của nhóm: chiết khấu gõ ở dải nhóm phía trên, ở đây chỉ hiện số tiền của phần này. */}
                      <td className={con ? "num muted" : "num"}>
                        {con ? (c.ck > 0 ? numf(c.ck) : "—") : oChietKhau([it], it.product_name)}
                      </td>
                      <td className="num">
                        <div className="markcell">
                          {editable ? (
                            <OHaiTab
                              pct={Math.round(c.m * 10) / 10}
                              so={c.ln}
                              disabled={busy}
                              ariaLabel={`Markup ${it.product_name}`}
                              titlePct="Markup (%) trên (giá vốn + chiết khấu) của dòng này"
                              titleSo="Tiền lợi nhuận của dòng này"
                              onNhap={(k, v) => datNhap([it.id], "ln", { k, v })}
                              onHuy={() => datNhap([it.id], "ln", null)}
                              onChot={(k, v) => { datNhap([it.id], "gia", null); commitLoiNhuan(it, k, v); }}
                            />
                          ) : (
                            <span>{pctf(c.m)} %<span className="meta"> · {numf(c.ln)} đ</span></span>
                          )}
                          {priceOverridden && <span className="meta">suy ra từ giá gõ tay</span>}
                        </div>
                      </td>
                      <td className="num">
                        <div className="pricecell">
                          <ONhapSo
                            className={`money ${priceOverridden ? "manual" : "auto"}`}
                            giaTri={Math.round(priceVal)}
                            donVi="đ"
                            disabled={!editable || busy}
                            ariaLabel={`Giá bán ${it.product_name}`}
                            title="Gõ tay giá bán dòng này — chiết khấu giữ nguyên, lợi nhuận là phần còn lại. Sửa lại Markup sẽ bỏ giá gõ tay."
                            onNhap={(v) => datNhap([it.id], "gia", v)}
                            onChot={(v) => commitGia(it, v)}
                            onHuy={() => datNhap([it.id], "gia", null)}
                          />
                          {priceOverridden && (
                            <span className="meta">
                              <span className="tag">Gõ tay</span>
                              {editable && it.gia_go_tay && (
                                <button type="button" className="reset" disabled={busy} onClick={() => veTheoMarkup(it)}>
                                  <Undo2 size={12} /> Về theo markup
                                </button>
                              )}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                  };

                  if (node.kind === "don") return [dongIt(node.it, false)];
                  // Ảnh của cụm đặt ở DẢI NHÓM: dải này chính là dòng sẽ in ra khách, mà cả cụm
                  // dùng chung một ảnh — treo ở từng phần con là mời người dùng upload 2 lần.
                  const tongVon = node.members.reduce((s, m) => s + calcItem(m).cost, 0);
                  const tongGoc = node.members.reduce((s, m) => s + calcItem(m).goc, 0);
                  const tongBan = node.members.reduce((s, m) => s + calcItem(m).selling, 0);
                  return [
                    <tr key={`nh-${node.key}`} className="qgrouphd">
                      <td>
                        <span className="qgrouphd__ten">{node.ten}</span>
                        <span className="qgrouphd__sub">
                          <span className="tag">{node.members.length} phần</span>
                          <span className="tag">in ra khách 1 dòng</span>
                        </span>
                        {oAnhCum(node.members[0], node.ten)}
                      </td>
                      <td className="num">{node.members[0].quantity.toLocaleString("vi-VN")}</td>
                      <td className="num muted">{numf(tongVon)}</td>
                      <td className="num">{oChietKhau(node.members, node.ten)}</td>
                      <td className="num muted">{tongGoc > 0 ? `${pctf(((tongBan / tongGoc) - 1) * 100)} %` : "—"}</td>
                      <td className="num strong">{vnd(tongBan)}</td>
                    </tr>,
                    ...node.members.map((m, k) => dongIt(m, true, k === node.members.length - 1, node.members[0].quantity)),
                  ];
                })}
              </tbody>
            </table>
            </div>
          </div>

          {/* Điều khoản & hiệu lực (Redesigned Modern WOW UI) */}
          <div className="panel terms-redesign-panel">
            <div className="panel__hd">
              <div className="terms-hd-title">
                <h3><FileText size={18} className="terms-hd-icon" /> Điều khoản &amp; Hiệu lực báo giá</h3>
                <span className="terms-badge-pill">
                  {editable ? "Đang mở chỉnh sửa" : "Bản đã khóa"}
                </span>
              </div>
            </div>

            <div className="terms">
              {/* Section 1: Điều khoản in cho khách */}
              <div className="terms-section">
                <div className="terms-section__title">
                  <span className="terms-section__lbl">Điều khoản áp dụng (Gửi khách hàng)</span>
                  <span className="terms-section__hint">Hiển thị trên bản in báo giá PDF</span>
                </div>

                {editable ? (
                  <textarea
                    className="terms-textarea"
                    rows={6}
                    value={termsText}
                    onChange={(e) => setTermsText(e.target.value)}
                    placeholder="Mỗi dòng là một điều khoản — bản in tự đánh số 1, 2, 3…"
                  />
                ) : (
                  <div className="terms-read-list">
                    {termsText
                      .split("\n")
                      .filter((line) => line.trim().length > 0)
                      .map((line, idx) => (
                        <div key={idx} className="terms-read-item">
                          <span className="terms-item-num">{idx + 1}</span>
                          <span className="terms-item-text">{line}</span>
                        </div>
                      ))}
                  </div>
                )}
              </div>

              {/* Section 2: Hạn hiệu lực & Thời gian */}
              <div className="terms-validity-bar">
                <div className="validity-pill-box">
                  <div className="validity-icon"><Calendar size={15} /></div>
                  <div className="validity-info">
                    <span className="validity-lbl">Hạn hiệu lực báo giá</span>
                    <div className="validity-val-row">
                      {editable ? (
                        <ChonNgay
                          className="datepill-edit"
                          aria-label="Hạn hiệu lực báo giá"
                          value={validUntilEdit ?? ""}
                          onChange={(v) => setValidUntilEdit(v)}
                        />
                      ) : (
                        <span className="validity-date-str">
                          {validUntilEdit ? fmtDate(validUntilEdit) : "Cho đến khi có thông báo mới"}
                        </span>
                      )}
                      {validUntilEdit && (
                        <span className="validity-tag">
                          {validity > 0 ? `Còn ${validity} ngày` : "Đã hết hạn"}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {verNote && (
                <div className="verline-box">
                  <span className="verline-lbl">Lý do điều chỉnh phiên bản này:</span>
                  <span className="verline-val">{verNote}</span>
                </div>
              )}

              <div className="tactions-redesign">
                {editable && (
                  <Button variant="secondary" disabled={busy} onClick={saveTerms}>
                    <Save size={15} /> Lưu nháp điều khoản
                  </Button>
                )}
                {canRequote && viewingLatest && d.allowed_transitions.includes("change_order") && (
                  <Button
                    variant="primary"
                    disabled={busy}
                    onClick={openRequote}
                    title="Giữ bản hiện tại + tạo phiên bản mới (bắt buộc ghi chú)"
                  >
                    <GitBranch size={15} /> Tạo phiên bản mới (v{d.version + 1})
                  </Button>
                )}
              </div>
            </div>
          </div>


          {d.status === "rejected" && d.cancel_reason && (
            <div className="panel">
              <div className="panel__hd"><h3><Ban size={16} /> Lý do từ chối</h3></div>
              <div className="hint" style={{ margin: "14px 16px", color: "var(--signal)" }}><span>{d.cancel_reason}</span></div>
            </div>
          )}
          {/* Lịch sử phiên bản */}
          <div className="panel">
            <div className="panel__hd">
              <h3><History size={16} /> Lịch sử phiên bản</h3>
              <button type="button" className="viewall" onClick={() => setCompareOn((v) => !v)}><ArrowLeftRight size={14} /> So sánh</button>
            </div>
            <div className="vh scrollbox">
              {d.versions.slice().sort((a, b) => b.version - a.version).map((v) => {
                const isCur = v.version === latestVer;
                const active = v.version === d.version;
                return (
                  <div
                    key={v.id}
                    className={`vrow${active ? " cur" : ""}${!isCur ? " old" : ""}`}
                    onClick={() => v.id !== d.id && reload(v.id)}
                    title={active ? "Đang xem phiên bản này" : "Bấm để xem phiên bản này"}
                  >
                    <span className="vtag">v{v.version}</span>
                    {active && <span className="vnow">Đang xem</span>}
                    <div className="vmid">
                      <div className="a">{v.change_reason || "—"}</div>
                      <div className="m">{fmtDate(v.created_at)}{isCur ? " · hiện tại" : ""}</div>
                    </div>
                    <div className="vright">
                      <div className="p rust-num">{vnd(v.total ?? 0)}</div>
                      <StatusPill status={v.status} statuses={statuses} />
                    </div>
                  </div>
                );
              })}
            </div>
            {compareOn && (
              <div style={{ padding: "0 14px 14px" }}>
                <div style={{ borderTop: "1px solid var(--rule-soft)", paddingTop: "12px", overflowX: "auto" }}>
                  <table className="cmp-tbl">
                    <thead>
                      <tr><th>Chỉ tiêu</th>{d.versions.slice().sort((a, b) => a.version - b.version).map((v) => <th key={v.id}>v{v.version}</th>)}</tr>
                    </thead>
                    <tbody>
                      <tr><td>Giá vốn (khóa)</td>{d.versions.slice().sort((a, b) => a.version - b.version).map((v) => <td key={v.id}>{v.total_cost != null ? vnd(v.total_cost) : "—"}</td>)}</tr>
                      <tr><td>Giá bán (đã VAT)</td>{d.versions.slice().sort((a, b) => a.version - b.version).map((v) => <td key={v.id}>{vnd(v.total ?? 0)}</td>)}</tr>
                      <tr>
                        <td>Chênh lệch</td>
                        {d.versions.slice().sort((a, b) => a.version - b.version).map((v, i, arr) => {
                          if (i === 0) return <td key={v.id}>—</td>;
                          const diff = (v.total ?? 0) - (arr[i - 1].total ?? 0);
                          if (diff === 0) return <td key={v.id}>0</td>;
                          return <td key={v.id}><span className={diff > 0 ? "up" : "down"}>{diff > 0 ? "+" : ""}{vnd(diff)}</span></td>;
                        })}
                      </tr>
                      <tr><td>Chiết khấu</td>{d.versions.slice().sort((a, b) => a.version - b.version).map((v) => <td key={v.id}>{v.discount ? vnd(v.discount) : "—"}</td>)}</tr>
                      <tr><td>Lý do</td>{d.versions.slice().sort((a, b) => a.version - b.version).map((v) => <td key={v.id} style={{ textAlign: "left", fontWeight: 400, whiteSpace: "normal" }}>{v.change_reason || "—"}</td>)}</tr>
                      <tr><td>Trạng thái</td>{d.versions.slice().sort((a, b) => a.version - b.version).map((v) => <td key={v.id}>{labelOf(statuses, v.status)}</td>)}</tr>
                      <tr><td>Ngày</td>{d.versions.slice().sort((a, b) => a.version - b.version).map((v) => <td key={v.id}>{fmtDate(v.created_at)}</td>)}</tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>


        </div>

        {/* ================= RIGHT: giá bán + khách hàng ================= */}
        <div className="stack">
          {/* Giá bán đề xuất (dark card) */}
          <div className="dk">
            <div className="dk__hd"><div className="dk__eyebrow"><DollarSign size={13} /> Giá bán đề xuất <span className="dk__ver">v{d.version}</span></div></div>
            <div className="dk__big">{numf(grandT)}<span className="u">đ</span></div>
            <div className="dk__meter">
              <div className="lbl"><span>Markup bình quân</span><b>{marginPctDisp}%</b></div>
              <div className="mbar"><span className="p" style={{ width: `${meterW}%` }} /></div>
            </div>
            <div className="dk__rows">
              <div className="drow"><span className="k">Giá vốn (khóa)</span><span className="v">{numf(costT)} đ</span></div>
              <div className="drow">
                {/* Chỉ cộng tổng — gõ riêng từng sản phẩm ở cột Chiết khấu trong bảng. Khoản này nằm TRONG
                    giá bán và sẽ hoàn lại khách. */}
                <span className="k">Chiết khấu (hoàn lại khách)</span>
                <span className="v">{discountT > 0 ? `+${numf(discountT)} đ` : "0 đ"}</span>
              </div>
              <div className="drow profit"><span className="k">Lợi nhuận</span><span className="v">{profitT >= 0 ? "+" : ""}{numf(profitT)} đ</span></div>
              <div className="drow"><span className="k">Giá bán (chưa VAT)</span><span className="v">{numf(netT)} đ</span></div>
              <div className="drow">
                <span className="k">
                  VAT
                  {editable ? (
                    <span className="vat-seg" role="group" aria-label="Chọn % VAT">
                      {[0, 5, 8, 10].map((p) => (
                        <button
                          key={p}
                          type="button"
                          className={`vat-opt${Math.round(singleVat) === p ? " on" : ""}`}
                          disabled={busy}
                          onClick={() => commitVat(p)}
                          title={`Áp VAT ${p}% cho báo giá`}
                        >
                          {p}%
                        </button>
                      ))}
                    </span>
                  ) : (
                    ` ${Math.round(singleVat)}%`
                  )}
                </span>
                <span className="v">{numf(vatT)} đ</span>
              </div>
              {/* Bỏ "Tổng cộng" — trùng số lớn "Giá bán đề xuất" ở đầu card. */}
            </div>

            {/* Báo giá đặc thù (giá trị cao / lời mỏng / bán dưới vốn): Nháp → TRÌNH DUYỆT → Chờ duyệt →
                Giám đốc Kinh doanh duyệt (→ Đã duyệt/gửi) hoặc từ chối (→ về Nháp). Trạng thái bám máy
                trạng thái báo giá (d.status), KHÔNG bám riêng exception_status (redesign-bao-gia §3). */}
            {d.exception_required && (
              <div className="dk__extra">
                <div className="appr-block appr-block--exc">
                  <div className="exc-title">Báo giá đặc thù — cần duyệt</div>
                  <div className="exc-chips">
                    {d.exceptions.map((e) => (
                      <span key={e.key} className="exc-chip">{e.label}</span>
                    ))}
                    {d.markup_pct != null && (
                      <span className="exc-chip exc-chip--num">Markup {d.markup_pct}%</span>
                    )}
                  </div>
                  <div className={`exc-status exc-status--${d.status === "pending_approval" ? "pending" : d.status === "approved" ? "approved" : d.status === "rejected" ? "rejected" : d.exception_status}`}>
                    {d.status === "pending_approval"
                      ? canApproveException
                        ? "Chờ quyết định của bạn."
                        : "Đã trình — đang chờ duyệt."
                      : d.status === "approved"
                        ? "Đã DUYỆT — bấm ‘Gửi khách’ để gửi báo giá cho khách."
                      : d.status === "sent" || d.status === "accepted" || d.status === "converted_to_order"
                        ? ""
                        : d.status === "rejected"
                          ? `Bị từ chối — bấm ‘Tạo phiên bản mới’ để sửa rồi trình duyệt lại.${d.exception_note ? " Lý do: " + d.exception_note : ""}`
                          : d.exception_status === "stale"
                            ? "Báo giá đã đổi so với lần duyệt trước — cần Trình duyệt lại."
                            : canRequote
                              ? "Bấm ‘Trình duyệt’ để gửi duyệt."
                              : "Chưa trình duyệt."}
                  </div>
                  {/* AI đã quyết định gần nhất — để NV biết ai duyệt/từ chối + khi nào + lý do (P8b). */}
                  {d.exception_decided_by_name && (
                    <div className="exc-decided">
                      <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                        {d.exception_decision === "rejected" ? <><X size={13} /> Từ chối</> : <><Check size={13} /> Duyệt</>}
                      </span>{" "}bởi{" "}
                      <b>{d.exception_decided_by_name}</b>
                      {d.exception_decided_at ? ` · ${fmtDate(d.exception_decided_at)}` : ""}
                      {d.exception_note ? ` · “${d.exception_note}”` : ""}
                    </div>
                  )}
                  {/* GĐ Kinh doanh duyệt/từ chối — CHỈ khi báo giá đang Chờ duyệt (pending_approval). */}
                  {d.status === "pending_approval" && canApproveException && (
                    <div className="exc-actions">
                      <textarea
                        className="exc-note"
                        value={apprNote}
                        onChange={(e) => setApprNote(e.target.value)}
                        placeholder="Lý do / ý kiến (bắt buộc — cả khi duyệt lẫn từ chối)"
                        rows={2}
                      />
                      <div className="exc-btns">
                        <Button variant="primary" disabled={apprSaving} onClick={() => submitQuoteApproval("approved")}>
                          {apprSaving ? "Đang ghi…" : "Duyệt"}
                        </Button>
                        <Button variant="ghost" disabled={apprSaving} onClick={() => submitQuoteApproval("rejected")}>
                          Từ chối (trả lại)
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Hoạt động — nhật ký tương tác THẬT: ai làm gì · khi nào (mọi vai trò đụng cùng phiếu).
              Ở cột phụ nên xếp 2 dòng: hành động ở trên, người + thời điểm ở dưới — nhồi cả ba vào
              một dòng thì tên dài ("Giám đốc · Giám đốc · Nguyễn Văn Giám") tự bẻ 3 dòng, rối. */}
          <div className="panel">
            <div className="panel__hd"><h3><Activity size={16} /> Hoạt động</h3><span className="tag">{acts.length} sự kiện</span></div>
            <div className="tl scrollbox">
              {acts.length === 0 ? (
                <div className="tl-empty">Chưa có hoạt động.</div>
              ) : acts.map((a, i) => {
                const m = ACT_META[a.action] ?? [Zap, "ash", a.action];
                const ActIcon = m[0];
                const tone = a.action === "quote_exception_rejected" || a.action === "transition_rejected" || a.action === "transition_cancelled" || a.action === "transition_expired"
                  ? "sig"
                  : i > 0 ? "mut" : "";
                return (
                  <div className={`tlrow ${tone}`} key={i}>
                    <span className="tlic"><ActIcon size={14} /></span>
                    <div className="tlb">
                      <div className="a">{m[2]}</div>
                      <div className="m">
                        {/* actor_name là "Phòng · Chức vụ · Tên" — cột phụ chỉ đủ chỗ cho TÊN,
                            chức danh đầy đủ nằm ở tooltip. Không cắt thì mỗi sự kiện chiếm 3 dòng. */}
                        {a.actor_name ? (
                          <><span className="who" title={a.actor_name}>{a.actor_name.split(" · ").pop()}</span> · </>
                        ) : null}
                        {fmtDateTime(a.at)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>


      {requoteOpen && (
        <div className="bg__overlay" onClick={() => setRequoteOpen(false)}>
          <div className="card bg__dialog" style={{ maxWidth: "480px" }} onClick={(e) => e.stopPropagation()}>
            <div className="bg__dialog-head">
              <h2>Tạo phiên bản mới</h2>
              <button type="button" className="bg__close" onClick={() => setRequoteOpen(false)} aria-label="Đóng"><X size={18} /></button>
            </div>
            <div style={{ padding: "16px" }}>
              <p style={{ margin: "0 0 10px", color: "var(--ash)", fontSize: "13px" }}>
                Ghi rõ lý do/thay đổi cho phiên bản này — <b>bắt buộc</b> (lưu vào Hoạt động &amp; Lịch sử phiên bản).
              </p>
              <textarea
                className="field-in"
                rows={3}
                autoFocus
                value={requoteNote}
                onChange={(e) => setRequoteNote(e.target.value)}
                placeholder="Ví dụ: KH yêu cầu giảm 5% · cập nhật số lượng · đổi quy cách giấy…"
              />
              {err && <div className="ro-note" style={{ marginTop: "8px", color: "var(--signal)" }}>{err}</div>}
              <div style={{ marginTop: "14px", display: "flex", gap: "8px", justifyContent: "flex-end" }}>
                <Button variant="ghost" disabled={busy} onClick={() => setRequoteOpen(false)}>Hủy</Button>
                <Button variant="primary" disabled={busy || !requoteNote.trim()} onClick={doRequote}><GitBranch size={15} /> Tạo phiên bản</Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {acceptOpen && (() => {
        const picked = d.items.filter((it) => acceptPicks[it.id]);
        const pickedIds = picked.map((it) => it.id);
        const pickedTotal = picked.reduce((s, it) => s + calcItem(it).final, 0);
        // Đếm theo SẢN PHẨM THƯƠNG MẠI (nhóm = 1), không đếm dòng — khách mua 2 thứ chứ không
        // phải 3: quyển catalogue (ruột + bìa) và sản phẩm 3.
        const soNhomDaChon = nhomTrongBaoGia.filter((n) =>
          n.kind === "don" ? !!acceptPicks[n.it.id] : n.members.every((m) => acceptPicks[m.id]),
        ).length;
        return (
          <div className="bg__overlay" onClick={() => setAcceptOpen(false)}>
            <div className="card bg__dialog" style={{ maxWidth: "560px" }} onClick={(e) => e.stopPropagation()}>
              <div className="bg__dialog-head">
                <h2>Khách chốt — chọn sản phẩm</h2>
                <button type="button" className="bg__close" onClick={() => setAcceptOpen(false)} aria-label="Đóng"><X size={18} /></button>
              </div>
              <div style={{ padding: "16px" }}>
                <div className="accept-pick-head">
                  <label className="accept-pick-all">
                    <input
                      type="checkbox"
                      checked={pickedIds.length === d.items.length}
                      ref={(el) => { if (el) el.indeterminate = pickedIds.length > 0 && pickedIds.length < d.items.length; }}
                      onChange={(e) => setAcceptPicks(Object.fromEntries(d.items.map((it) => [it.id, e.target.checked])))}
                    />
                    <span>Chọn tất cả</span>
                  </label>
                  <span className="accept-pick-head-count">{soNhomDaChon}/{nhomTrongBaoGia.length} khách lấy</span>
                </div>
                {/* Khách chốt theo SẢN PHẨM THƯƠNG MẠI: 1 ô tick cho cả nhóm. Cho tick lẻ ruột
                    mà bỏ bìa là ra đơn không làm được cuốn sách — nên nhóm đi liền một khối. */}
                <div className="accept-pick-list">
                  {nhomTrongBaoGia.map((node) => {
                    if (node.kind === "don") {
                      const it = node.it;
                      const on = !!acceptPicks[it.id];
                      return (
                        <label key={it.id} className={`accept-pick-row${on ? "" : " off"}`}>
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={(e) => setAcceptPicks((p) => ({ ...p, [it.id]: e.target.checked }))}
                          />
                          <span className="accept-pick-name">
                            {it.product_name}
                            <span className="accept-pick-qty">{it.quantity.toLocaleString("vi-VN")} {it.unit}</span>
                          </span>
                          <span className="accept-pick-amt">{vnd(calcItem(it).final)}</span>
                        </label>
                      );
                    }
                    const on = node.members.every((m) => acceptPicks[m.id]);
                    const dau = node.members[0];
                    const tien = node.members.reduce((s, m) => s + calcItem(m).final, 0);
                    return (
                      <label key={node.key} className={`accept-pick-row${on ? "" : " off"}`}>
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={(e) =>
                            setAcceptPicks((p) => ({
                              ...p,
                              ...Object.fromEntries(node.members.map((m) => [m.id, e.target.checked])),
                            }))
                          }
                        />
                        <span className="accept-pick-name">
                          {node.ten}
                          <span className="accept-pick-qty">
                            {dau.quantity.toLocaleString("vi-VN")} {dau.unit} ·{" "}
                            {node.members.map((m) => m.product_name).join(" + ")}
                          </span>
                        </span>
                        <span className="accept-pick-amt">{vnd(tien)}</span>
                      </label>
                    );
                  })}
                </div>
                <div className="accept-pick-sum">
                  <span>Khách chốt <b>{soNhomDaChon}</b>/{nhomTrongBaoGia.length} sản phẩm</span>
                  <span className="accept-pick-sum-amt">{vnd(pickedTotal)}</span>
                </div>
                {err && <div className="ro-note" style={{ marginTop: "8px", color: "var(--signal)" }}>{err}</div>}
                <div style={{ marginTop: "14px", display: "flex", gap: "8px", justifyContent: "flex-end" }}>
                  <Button variant="ghost" disabled={busy} onClick={() => setAcceptOpen(false)}>Hủy</Button>
                  <Button variant="primary" disabled={busy || pickedIds.length === 0} onClick={() => doAccept(pickedIds)}><Check size={15} /> Xác nhận khách chốt</Button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Xem lớn ảnh minh họa — thumbnail trong bảng bé, phải soi được trước khi gửi khách. */}
      {anhXem && (
        <div
          className="att-lightbox"
          role="presentation"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setAnhXem(null); }}
        >
          <div className="att-lightbox__box" role="dialog" aria-modal="true" aria-label={anhXem.ten}>
            <header className="att-lightbox__head">
              <span className="att-lightbox__name">Ảnh minh họa — {anhXem.ten}</span>
              <div className="att-lightbox__acts">
                <a href={anhXem.url} target="_blank" rel="noreferrer" title="Mở tab mới"><ExternalLink size={17} /></a>
                <button type="button" onClick={() => setAnhXem(null)} aria-label="Đóng"><X size={18} /></button>
              </div>
            </header>
            <div className="att-lightbox__body">
              <img src={anhXem.url} alt={`Ảnh minh họa ${anhXem.ten}`} />
            </div>
          </div>
        </div>
      )}

      {showPrint && <QuotationPrintModal d={d} canDownload={canExport} onClose={() => setShowPrint(false)} />}
    </main>
  );
}

// ---- Bản in báo giá (một ngôn ngữ — tiếng Việt) ----------------------------
function QuotationPrintModal({
  d,
  canDownload,
  onClose,
}: {
  d: QuotationDetail;
  /** Quyền chi tiết `export`: thiếu thì chỉ xem trước, ẩn nút In. */
  canDownload: boolean;
  onClose: () => void;
}) {
  // Tự in + tự đóng khung xem trước (chỉ khi có quyền export). Xem `bao-gia-in-tu-dong.ts`:
  // listener `afterprint` PHẢI nằm ở effect riêng, không thì StrictMode gỡ mất và nút
  // "Xem bản in" chết câm từ lần bấm thứ hai.
  useInTuDong(canDownload, onClose);

  const now = new Date();
  const p2 = (n: number) => (n < 10 ? "0" : "") + n;
  // Đơn giá KHÔNG làm tròn: dòng gộp (ruột + bìa) hay ra số lẻ .5, làm tròn xong khách nhân
  // Số lượng × Đơn giá ra khác Thành tiền. Giữ tối đa 2 số lẻ để phép nhân trên giấy luôn khớp.
  const donGia = (v: number) => v.toLocaleString("vi-VN", { maximumFractionDigits: 2 });

  // Bảng CHỈ chào ĐƠN GIÁ chưa VAT — tờ gửi khách không còn dòng cộng/VAT/tổng thanh toán.
  // GỘP NHÓM: ruột + bìa cùng nhãn `nhom` in ra 1 dòng "quyển sách" (khách mua 1 cuốn, không phải
  // 1 ruột + 1 bìa). Chỉ gộp ở bản in — dữ liệu vẫn từng dòng để markup riêng + xuống SX tách lệnh.
  const lines = gopTheoNhom(d.items, (it) => ({
    nhom: it.nhom,
    ten: it.product_name,
    soLuong: it.quantity,
    donViTinh: it.unit,
    dvtNhom: it.dvt_nhom,
    thanhTien: Math.max(0, it.selling_price),   // chưa VAT — đã gồm chiết khấu (hoàn lại khách sau)
    tienVat: it.vat_amount,
    vatPct: it.vat_percent,
    dienGiai: it.dien_giai,
  }));
  // Tầng gộp thứ HAI: các cụm CÙNG TÊN về một dòng, mỗi SL là một mức trong ba cột số. Ba mức
  // của cùng một món trước đây in ra ba dòng lặp y hệt phần mô tả (chốt 05/09/2026).
  const dongIn = gopTrungTen(lines);

  // Điều khoản in ra phiếu: mỗi dòng của terms_text = 1 mục (bản in tự đánh số). Bỏ trống → mặc định.
  const termLines = (d.terms_text || DEFAULT_TERMS)
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  return (
    <div className={`bg__overlay${canDownload ? " q-print-silent" : ""}`} onClick={onClose}>
      {/* Rộng đủ ôm tờ A4 (210mm ≈ 794px). Việc CUỘN nằm ở khung này, không nằm ở tờ — tờ luôn
          giữ đúng khổ A4 để xem trước ra sao thì in ra vậy. */}
      <div
        className="card bg__dialog"
        style={{ maxWidth: "820px", padding: 0, maxHeight: "88vh", overflow: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg__dialog-head">
          <h2>Xem trước báo giá in</h2>
          <button type="button" className="bg__close" onClick={onClose} aria-label="Đóng"><X size={18} /></button>
        </div>
        <div className="qpdf">
          {/* LETTERHEAD: nguyên tấm ảnh letterhead của công ty (tên + logo + liên hệ + chứng nhận
              + viền kép đã có sẵn trong ảnh) — không dựng lại bằng chữ nữa. */}
          <header className="q-mh">
            <img className="q-mh-img" src={letterheadUrl} alt={SVN_COMPANY.name} />
          </header>

          <div className="q-date-line">{SVN_COMPANY.placeOfIssue}, ngày {p2(now.getDate())} tháng {p2(now.getMonth() + 1)} năm {now.getFullYear()}</div>

          {/* KÍNH GỬI — tên + MST + địa chỉ giao hàng + người liên hệ của báo giá (Sale đã chọn tay
              khi lập phiếu). Tên + địa chỉ dài nên chiếm cả dòng; MST và người liên hệ ngắn nên đứng
              chung một dòng hai cột. Trống thì bỏ hẳn ô, không in "—". */}
          <div className="q-salut">
            <span className="q-salut-lbl">Kính gửi:</span>
            <b className="q-salut-full">{d.customer?.name ?? "—"}</b>
            <span>Địa chỉ:</span>
            <span className="q-salut-full">{d.delivery_address || "—"}</span>
            {d.customer?.tax_code && <><span>Mã số thuế:</span><span>{d.customer.tax_code}</span></>}
            {d.contact_name_snapshot && <><span>Người liên hệ:</span><span>{d.contact_name_snapshot}</span></>}
          </div>

          <div className="q-th"><h1>BẢN BÁO GIÁ</h1></div>

          <div className="q-intro">Cảm ơn Quý khách đã quan tâm sản phẩm của {SVN_COMPANY.name}. Chúng tôi xin gửi bảng báo giá chi tiết như sau:</div>

          {/* CHI TIẾT: đã có "BẢN BÁO GIÁ" ở trên nên bỏ tiêu đề mục lặp nghĩa; vào bảng luôn.
              Header xám, viền mảnh, cột tiền căn phải + tfoot Cộng/VAT */}
          <table className="q-tbl">
            {/* Bỏ 2 cột không mang tin: "Kích thước" (khổ đã nằm ở dòng đầu phần diễn giải) và
                "Mã hàng" (dòng gộp ruột+bìa có 2 mã khác nhau nên luôn để trống — mà báo giá kiểu
                quyển sách thì hầu hết dòng đều gộp). Chỗ trống dồn cho mô tả và 3 cột số. */}
            <colgroup>
              <col style={{ width: "5%" }} /><col style={{ width: "35%" }} />
              <col style={{ width: "9%" }} /><col style={{ width: "12%" }} />
              <col style={{ width: "15%" }} /><col style={{ width: "24%" }} />
            </colgroup>
            <thead>
              <tr>
                <th>STT</th>
                <th>Mô tả sản phẩm</th>
                <th>ĐVT</th>
                <th>Số lượng</th>
                <th>Đơn giá<span className="q-sub">chưa VAT</span></th>
                <th>Hình ảnh minh họa</th>
              </tr>
            </thead>
            <tbody>
              {/* Báo giá chưa có dòng nào: in ra khung bảng rỗng trông như lỗi in. Nói thẳng ra
                  giấy là chưa có sản phẩm, để người cầm tờ biết đây không phải trang bị mất chữ. */}
              {dongIn.length === 0 && (
                <tr>
                  <td className="c q-empty" colSpan={6}>Báo giá chưa có sản phẩm nào.</td>
                </tr>
              )}
              {dongIn.map((g, i) => {
                // Nhóm 1 dòng → mã hàng + ghi chú của chính dòng đó; nhóm gộp → để trống vì mã
                // của ruột và bìa khác nhau, in một cái ra là sai. Nhiều MỨC cũng vậy: mỗi mức có
                // ghi chú riêng, in ghi chú của mức đầu lên cả cụm là gán nhầm cho hai mức kia.
                const don = g.goc.length === 1 ? g.goc[0] : null;
                // Ảnh minh họa thuộc CẢ CỤM (mọi dòng trong cụm mang cùng URL — backend ghi cả
                // cụm). Lấy cái đầu tiên có giá trị để báo giá cũ / dòng vừa thêm tay không làm
                // mất ảnh của cụm.
                const anhCum = g.goc.map((it) => it.anh_minh_hoa).find(Boolean) ?? null;
                return (
                  <Fragment key={g.key}>
                    {g.muc.map((m, j) => (
                      // STT · mô tả · ĐVT kéo suốt các mức (rowSpan); chỉ 3 cột số tách theo mức.
                      <tr key={j} className={j > 0 ? "q-muc-tiep" : undefined}>
                        {j === 0 && (
                          <>
                            <td className="c" rowSpan={g.muc.length}>{i + 1}</td>
                            <td className="q-desc" rowSpan={g.muc.length}>
                              <span className="q-prod">{g.ten}</span>{don?.note ? `, ${don.note}` : ""}
                              {/* Diễn giải quy cách: gạch đầu dòng dưới tên SP (nhóm gộp → mỗi phần 1 mục). */}
                              {g.dienGiai.length > 0 && (
                                <ul className="q-dg">
                                  {g.dienGiai.map((ln, k) => <li key={k}>{ln}</li>)}
                                </ul>
                              )}
                            </td>
                            <td className="c q-dvt" rowSpan={g.muc.length}>{g.donViTinh}</td>
                          </>
                        )}
                        <td className="r">{m.soLuong.toLocaleString("vi-VN")}</td>
                        <td className="r">{donGia(m.soLuong > 0 ? m.thanhTien / m.soLuong : m.thanhTien)}</td>
                        {/* Ảnh của cụm — kéo suốt các mức như STT/ĐVT: các mức chỉ khác SỐ LƯỢNG,
                            vẫn là một món nên in một ảnh, không lặp ba lần. */}
                        {j === 0 && (
                          <td className="c q-anh" rowSpan={g.muc.length}>
                            {anhCum
                              ? <img src={assetUrl(anhCum) ?? ""} alt={`Ảnh minh họa ${g.ten}`} />
                              : null}
                          </td>
                        )}
                      </tr>
                    ))}
                  </Fragment>
                );
              })}
            </tbody>
            {/* KHÔNG có dòng Cộng tiền hàng / VAT / Tổng thanh toán: chủ xưởng chốt 10/09/2026 —
                tờ gửi khách chỉ chào ĐƠN GIÁ từng món, khách chọn món và số lượng rồi mới ra
                tổng ở đơn hàng. Số tổng vẫn tính đủ và hiện ở màn soạn nội bộ. */}
          </table>

          {/* ĐIỀU KHOẢN — bám dữ liệu thật (terms_text), tự đánh số theo dòng */}
          <div className="q-sec">Điều khoản</div>
          <ol className="q-notes">
            {termLines.map((t, i) => <li key={i}>{t}</li>)}
          </ol>

          {/* CHỮ KÝ — chỉ bên bán; khách xác nhận trên đơn hàng, không ký tay ở bản báo giá này */}
          <div className="q-signs">
            <div>
              <div className="q-role">{SVN_COMPANY.name}</div>
              <div className="q-role-title">T. GIÁM ĐỐC</div>
              <div className="q-sp" />
            </div>
          </div>
        </div>
        <div className="bg__dialog-actions" style={{ padding: "16px 20px" }}>
          <Button variant="ghost" onClick={onClose}>Đóng</Button>
          {canDownload && (
            <Button variant="primary" onClick={() => window.print()}>In / Lưu PDF</Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- helpers cho detail view -----------------------------------------------
function vnd(v: number): string {
  return Math.round(v).toLocaleString("vi-VN") + "₫";
}
function numf(v: number): string {
  return Math.round(v).toLocaleString("vi-VN");
}

