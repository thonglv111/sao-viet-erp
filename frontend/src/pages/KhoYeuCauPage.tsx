// Màn "Hộp yêu cầu kho" — thủ kho / quản lý kho / kế toán kho (scope `all`).
//
// Yêu cầu đã duyệt VÀ phiếu nhập/xuất nằm CÙNG MỘT MÀN, phân bằng tab: với người trong kho
// đây là một việc liên tục (nhận yêu cầu → lấy hàng theo lô → ghi sổ), tách hai màn là bắt họ
// nhảy qua lại giữa hai danh sách của cùng một chứng từ.
//
// Hai cột nhạy cảm — "Tồn khả dụng" và "Giá vốn" — KHÔNG render khi thiếu quyền: cột biến mất
// khỏi <thead> chứ không hiện "—". Dấu gạch vẫn là một câu trả lời ("chỗ này có số, bạn không
// được xem"), còn ở đây phải im lặng hoàn toàn.
import { ChonNgay } from "../components/ChonNgay";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { AlertTriangle, ChevronRight, FileText, Package, Pencil, Plus, Printer } from "lucide-react";
import {
  ApiError,
  api,
  anhNho, assetUrl,
  type DieuChinhLichSu,
  type HangLoai,
  type StockAllocationLine,
  type StockLot,
  type StockRequest,
  type StockRequestLine,
  type StockRequestStatus,
  type StockThreshold,
  type StockVoucher,
  type StockVoucherAttachment,
  type StockVoucherLine,
  type StockVoucherLineInput,
} from "../api/client";
import { crud } from "../api/rebuildCatalog";
import { useAuth } from "../auth/useAuth";
import { useCan } from "../auth/permissions";
import { Button } from "../components/Button";
import { Icon } from "../components/Icons";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { MaterialCombobox } from "../components/MaterialCombobox";
import { PhanTrangDayDu } from "../components/PhanTrangDayDu";
import {
  CuonLuoi, ChonCot, LocNhanhTrangThai, OTim, rongLuoi, soVN, useCauHinhLuoi, type CotLuoi, type MauTT,
} from "../components/LuoiDs";
import { EmptyRow as DongTrongLds } from "../components/EmptyState";
import { Select } from "../components/Select";
import { fmtDate, fmtDateISO, fmtDateTime, money } from "../utils/format";
import {
  printStockVoucher,
  printTransferVoucher,
  type StockVoucherPrintData,
  type TransferPrintData,
} from "../utils/printStockVoucher";
import {
  DecimalInput,
  ChipLoaiYeuCau,
  ChipTrangThaiDieuChuyen,
  ChipTrangThaiYeuCau,
  RequestStatusBadge,
  VoucherStatusBadge,
  TransferStatusBadge,
  type TransferStatus,
  DEFAULT_PAGE_SIZE,
  fmtQty,
  GiaBanDong,
  GiaGocKcs,
  isOverdue,
  readStoredKho,
  todayISO,
  writeStoredKho,
} from "./khoShared";
import { tenDonVi, useNapTenDonVi } from "./tenDonVi";
import { chuanKho, coDonViGoc, nhanKhoGiay, toTuKg } from "../lib/khoGiay";
import { khoaTonKho } from "../auth/quyenKho";
import {
  LOC_MAN_YCK_TRONG,
  MAN_YEU_CAU_KHO,
  MOC_YEU_CAU_KHO,
  docLocManYCK,
  ghiLocManYCK,
  thamSoLocYCK,
  useDieuKienYeuCauKho,
  type LocManYCK,
  type LocYeuCauKho,
} from "./loc-kho/dieu-kien-yeu-cau-kho";
import { ThanhLoc } from "./thanh-loc/ThanhLoc";
import { dkTheoTab, soDaAp, type DieuKien } from "./thanh-loc/thanh-loc";
import { thamSoKy } from "./thanh-loc/ky-danh-sach";
import { useLocMan } from "./thanh-loc/useLocMan";
import { NganPhai, useDongNgan } from "./ke-toan/shared/NganPhai";
import {
  HangA,
  IconPhieu,
  KvA,
  LichSuA,
  NguonA,
  SoA,
  TheA,
  TheGiaoHang,
  TheNguonHang,
  TienDoA,
  canLucCua,
  tuKcs,
  dongDu,
  lapVaGhiSoCungLuc,
  lichSuYeuCau,
  tenDv,
  type MucLichSu,
} from "./khoNganA";
import { OMuaCho } from "./mua-hang/mua-cho/OMuaCho";
import { khopGanDung } from "../utils/timGanDung";
import { ngayVN } from "../utils/ky";
import "./rebuild-catalog.css";
import "./kho-request.css";
import "./ke-toan/ke-toan.css";

const KHO_KEY = "kho.yeu-cau.kho-id";

type TabId = "tat-ca" | "can-cap" | "done" | "da-huy";

const TAB_STATUSES: Record<TabId, StockRequestStatus[]> = {
  "tat-ca": ["approved", "received", "preparing", "partial", "done", "cancelled"],
  // "Cần cấp" = MỌI yêu cầu còn phải cấp (chưa xong, chưa hủy) → gồm cả "Đã cấp một phần" để thủ
  // kho thấy ngay cái đang dở mà nhập/cấp tiếp, không bị chìm trong "Tất cả".
  "can-cap": ["approved", "received", "preparing", "partial"],
  done: ["done"],
  "da-huy": ["cancelled"],
};
// Một lần gọi cho cả 4 tab yêu cầu → số trên tab luôn khớp bảng, không lệch giữa các lần fetch.
const INBOX_STATUSES: StockRequestStatus[] = [
  "approved",
  "received",
  "preparing",
  "partial",
  "done",
  "cancelled",
];
const FULFILLABLE: StockRequestStatus[] = ["approved", "received", "preparing", "partial"];

export interface KhoOption {
  id: number;
  ma: string;
  ten: string;
}

/** Ký hiệu "≈" NHỎ đứng trước số khi giá trị HIỂN THỊ đã bị làm tròn (giá trị thật lẻ hơn).
 *  `decimals` = số chữ số lẻ của cách hiển thị. Tròn khớp → không hiện gì (số tròn để nguyên). */
function ApproxMark({ raw, decimals }: { raw: number; decimals: number }) {
  const factor = 10 ** decimals;
  if (Math.abs(raw - Math.round(raw * factor) / factor) <= 1e-9) return null;
  return <span className="kho-approx" title="Số đã làm tròn để hiển thị (giá trị thật lẻ hơn)">≈ </span>;
}

export function KhoYeuCauPage({
  eventTick = 0,
  dieuChuyen = false,
  openRequestId = null,
  onOpenRequestConsumed,
}: {
  eventTick?: number;
  /** Tab ĐIỀU CHUYỂN: chỉ hiện yêu cầu điều chuyển (dieu_chuyen=true). */
  dieuChuyen?: boolean;
  /** Bấm thông báo → mở sẵn drawer "ứng theo yêu cầu" đúng id này. */
  openRequestId?: number | null;
  onOpenRequestConsumed?: () => void;
}) {
  const { token } = useAuth();
  const can = useCan();
  // Cột Tiến độ in tên đơn vị ("tờ") chứ không in mã (`to_tp`) — nạp bảng tên đơn vị cho danh sách.
  useNapTenDonVi();
  const canCreate = can("kho", "create");
  // Cột ẩn / thứ tự cột người xem đã chọn — nhớ theo màn (điều chuyển có lưới riêng).
  const luoi = useCauHinhLuoi(dieuChuyen ? "kho-dieu-chuyen" : "kho-phieu-yeu-cau");
  // Ghi sổ đã GỘP vào quyền "create" (bỏ tách "post"/SoD) — khớp backend: post_voucher chỉ đòi
  // create. Ai lập được phiếu là ghi sổ được luôn, không còn bước "Chờ ghi sổ" chờ người khác.
  const canPost = canCreate;
  const canViewCost = can("kho", "view_cost");

  const [khoList, setKhoList] = useState<KhoOption[]>([]);
  // Cột "tồn khả dụng" trên dòng yêu cầu — đọc quyền của màn TỒN KHO, mỗi kho một dòng
  // `ton_kho_<id>` (05/10/2026). Ngăn chi tiết tự hỏi đúng kho của yêu cầu; cờ này chỉ dùng cho yêu
  // cầu CHƯA chọn kho — số khi đó là gộp mọi kho nên phải xem được MỌI kho (khớp máy chủ).
  const canViewStock = khoList.length > 0 && khoList.every((k) => can(khoaTonKho(k.id), "read"));
  const [khoId, setKhoId] = useState<number | null>(() => readStoredKho(KHO_KEY));
  const [requests, setRequests] = useState<StockRequest[]>([]);
  const [totalCount, setTotalCount] = useState(0);         // tổng bản ghi khớp lọc (từ BE)
  const [counts, setCounts] = useState<Record<string, number>>({}); // số theo trạng thái → badge tab
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<TabId>("can-cap");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  // Kỳ (Ngày yêu cầu / Ngày cần / Ngày duyệt) + Phòng ban, Người yêu cầu, Kho — lọc ở máy chủ,
  // chung khoá URL với màn "Yêu cầu nhập xuất" (cùng mục thanh bên).
  const [locMan, setLocManGoc] = useLocMan(MAN_YEU_CAU_KHO, LOC_MAN_YCK_TRONG, docLocManYCK, ghiLocManYCK);
  const setLocMan = (t: LocManYCK) => {
    setLocManGoc(t);
    setPage(1);
  };
  const dieuKien = useDieuKienYeuCauKho(dieuChuyen);
  const khoaLoc = JSON.stringify({ ...thamSoKy(locMan.ky), ...thamSoLocYCK(locMan.loc, dieuChuyen) });

  const [openRequest, setOpenRequest] = useState<number | null>(null);
  const [creatingFor, setCreatingFor] = useState<StockRequest | null>(null);
  const [openVoucher, setOpenVoucher] = useState<number | null>(null);
  // Đếm số lần phiếu (mở chồng) đổi số — ngăn yêu cầu bên dưới nghe số này để nạp lại.
  const [taiNgan, setTaiNgan] = useState(0);
  // Tab ĐIỀU CHUYỂN: một drawer DUY NHẤT (phiếu điều chuyển làm mặt tiền) — bỏ qua openRequest/
  // openVoucher/creatingFor của nhánh Nhập/Xuất.
  const [openTransfer, setOpenTransfer] = useState<number | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    crud("/api/kho")
      .list(token, { active: true })
      .then((r) => {
        if (cancelled) return;
        const items = r.items.map((w) => ({
          id: Number(w.id),
          ma: String(w.ma),
          ten: String(w.ten),
        }));
        setKhoList(items);
        setKhoId((prev) => {
          if (prev != null && items.some((w) => w.id === prev)) return prev;
          return items.length ? items[0].id : null;
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    writeStoredKho(KHO_KEY, khoId);
  }, [khoId]);

  const load = useCallback(() => {
    if (!token) return;
    setLoading(true);
    // KHÔNG lọc theo kho: yêu cầu giờ không gắn kho (kho quyết ở phiếu) → mọi yêu cầu đã duyệt
    // đều vào chung một hộp cho thủ kho xử lý. Ô kho ở toolbar chỉ là kho MẶC ĐỊNH khi lập phiếu.
    // BE-paging: chỉ tải ĐÚNG trang theo tab + lọc ngày; đếm số theo trạng thái riêng (badge tab).
    const filters = {
      q: q || null,
      dieu_chuyen: dieuChuyen,
      loc: JSON.parse(khoaLoc),
    };
    Promise.all([
      api.kho.deNghi.list(token, { ...filters, trang_thai: TAB_STATUSES[tab], page, size: pageSize }),
      api.kho.deNghi.tabCounts(token, { ...filters, trang_thai: INBOX_STATUSES }),
    ])
      .then(([r, c]) => {
        setRequests(r.items);
        setTotalCount(r.total);
        setCounts(c);
        setError(null);
      })
      .catch((e) =>
        setError(e instanceof ApiError ? e.message : "Không tải được hộp yêu cầu kho."),
      )
      .finally(() => setLoading(false));
  }, [token, q, dieuChuyen, khoaLoc, tab, page, pageSize]);

  // "Lập phiếu" / "Xem phiếu": yêu cầu đã có phiếu ĐANG CHỜ GHI SỔ (`open_voucher_id`) thì MỞ LẠI
  // đúng phiếu đó — thấy nguyên dữ liệu đã nhập + Ghi sổ/Hủy — thay vì đẻ ra phiếu trống (mất dữ
  // liệu + tạo trùng). Chưa có mới mở form lập mới.
  const openFulfil = useCallback((r: StockRequest) => {
    setOpenRequest(null);
    if (r.open_voucher_id != null) setOpenVoucher(r.open_voucher_id);
    else setCreatingFor(r);
  }, []);

  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    if (eventTick > 0) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventTick]);

  // Bấm thông báo "yêu cầu mới chờ cấp" → mở sẵn drawer ứng theo đúng yêu cầu đó.
  useEffect(() => {
    if (openRequestId == null) return;
    if (dieuChuyen) setOpenTransfer(openRequestId);
    else setOpenRequest(openRequestId);
    onOpenRequestConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRequestId]);

  useEffect(() => {
    setPage(1);
  }, [tab, q, khoId, khoaLoc, pageSize]);

  // Số trên tab = CỘNG số theo trạng thái (BE trả `counts`) của các trạng thái thuộc tab đó.
  function countOf(id: TabId): number {
    return TAB_STATUSES[id].reduce((s, st) => s + (counts[st] ?? 0), 0);
  }

  // BE đã lọc (tab + ngày + q) + phân trang + sắp theo id giảm (≈ created_at desc như sortInbox)
  // → dùng thẳng danh sách trả về làm trang hiện tại, không cắt/lọc lại ở client.
  const total = totalCount;
  const pageRequests = requests;
  // "Mới" = yêu cầu MỚI NHẤT — nằm đầu TRANG 1 (BE sắp id desc); trang khác không đánh dấu.
  const newestReqId = page === 1 ? (requests[0]?.id ?? null) : null;

  // Tab ĐIỀU CHUYỂN đổi nhãn "Cần cấp" → "Chờ ghi sổ" (giữ nguyên TabId/TAB_STATUSES: can-cap =
  // yêu cầu NHẬP đích còn phiếu nháp chờ ghi sổ). Nhánh Nhập/Xuất giữ nhãn cũ.
  const tabs: { id: TabId; label: string }[] = [
    { id: "tat-ca", label: "Tất cả" },
    { id: "can-cap", label: dieuChuyen ? "Chờ ghi sổ" : "Cần xử lý" },
    { id: "done", label: "Hoàn tất" },
    { id: "da-huy", label: "Đã hủy" },
  ];
  // Trạng thái trong nút Lọc = chính dải chip (đọc/ghi `tab`), không đẻ state thứ hai.
  const dkDu: DieuKien<LocYeuCauKho>[] = [
    dkTheoTab<LocYeuCauKho>({
      tabs: tabs.map((t) => ({ id: t.id, nhan: t.label, so: countOf(t.id) })),
      tatCa: "tat-ca", dang: tab, dat: (id) => setTab(id as TabId),
    }),
    ...dieuKien,
  ];

  // Cột theo quyền: "Thao tác" chỉ cho người lập phiếu; "Tổng giá vốn" của điều chuyển chỉ khi thấy giá.
  const cotDs = dieuChuyen
    ? COT_DC.filter((c) => (c.key !== "giavon" || canViewCost) && (c.key !== "nut" || canCreate))
    : COT_YCK.filter((c) => c.key !== "nut" || canCreate);
  const cotHien = luoi.rongHien(luoi.xep(cotDs).filter((c) => !luoi.an.has(c.key)));
  const muc = tabs.map((t) => ({ key: t.id, label: t.label, count: countOf(t.id), mau: MAU_TAB[t.id] }));
  const coLoc = locMan.ky.loai !== "tat_ca" || soDaAp(dieuKien, locMan.loc) > 0;
  const donVi = dieuChuyen ? "phiếu" : "yêu cầu";
  const moDong = (r: StockRequest) => (dieuChuyen ? setOpenTransfer(r.id) : setOpenRequest(r.id));
  const dangMo = dieuChuyen ? openTransfer : openRequest;

  return (
    <>
      {/* Tên màn nằm ở đầu trang chung của `KhoPage` (một h1 cho cả hai tab); không có nút chính ở
          tab này — nút "Lập phiếu" nằm trên từng dòng. */}
      <section className="lds-loc">
        <LocNhanhTrangThai muc={muc} dang={tab} onChon={(k) => setTab(k as TabId)} />
        <div className="lds-loc__thanh tl-thanh" role="search">
          <OTim value={q} onChange={setQ} placeholder="Tìm mã yêu cầu, số phiếu, vật tư" ariaLabel="Tìm phiếu từ yêu cầu" />
          <ThanhLoc
            ky={locMan.ky}
            moc={MOC_YEU_CAU_KHO}
            onKy={(ky) => setLocMan({ ...locMan, ky })}
            dieuKien={dkDu}
            loc={locMan.loc}
            onLoc={(loc) => setLocMan({ ...locMan, loc })}
          />
          <ChonCot cot={cotDs} {...luoi.chonCot} />
        </div>
      </section>

      <div className="lds-sheet">
        <CuonLuoi ghim={luoi.soGhim(cotHien)}>
          <table className="lds-g" style={{ minWidth: rongLuoi(cotHien) }}>
            <colgroup>
              {cotHien.map((c) => <col key={c.key} style={c.w ? { width: c.w } : undefined} />)}
            </colgroup>
            <thead>
              <tr>{cotHien.map((c) => <th key={c.key} className={c.n ? "n" : undefined}>{c.key === "nut" ? "" : c.label}{luoi.keo(c.key)}</th>)}</tr>
            </thead>
            <tbody>
              {loading && requests.length === 0 ? (
                <DongTrongLds colSpan={cotHien.length} trangThai="dang-tai" />
              ) : error ? (
                <tr>
                  <td colSpan={cotHien.length} className="lds-trong">
                    <span className="lds-do">{error}</span>{" "}
                    <button type="button" className="lds-lk" onClick={load}>Thử lại</button>
                  </td>
                </tr>
              ) : requests.length === 0 ? (
                <tr>
                  <td colSpan={cotHien.length} className="lds-trong">
                    {coLoc || q
                      ? "Không có yêu cầu nào khớp điều kiện đang lọc."
                      : dieuChuyen
                        ? "Chưa có phiếu điều chuyển. Tạo bằng nút Chuyển kho ở màn tồn kho."
                        : tab === "tat-ca" ? "Chưa có yêu cầu nào." : "Không có yêu cầu nào ở nhóm này."}{" "}
                    {(coLoc || q) ? (
                      <button type="button" className="lds-lk"
                        onClick={() => { setQ(""); setTab("tat-ca"); setLocMan(LOC_MAN_YCK_TRONG); }}>
                        Xoá bộ lọc
                      </button>
                    ) : tab !== "tat-ca" ? (
                      <button type="button" className="lds-lk" onClick={() => setTab("tat-ca")}>Xem tất cả</button>
                    ) : null}
                  </td>
                </tr>
              ) : (
                requests.map((r) => (
                  <tr
                    key={r.id}
                    className={`lds-dong${dangMo === r.id ? " is-chon" : ""}`}
                    tabIndex={0}
                    onClick={() => moDong(r)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        moDong(r);
                      }
                    }}
                  >
                    {cotHien.map((c) =>
                      dieuChuyen
                        ? <ODieuChuyen key={c.key} cot={c.key} r={r} moi={r.id === newestReqId} canViewCost={canViewCost}
                            onMo={() => setOpenTransfer(r.id)} />
                        : <OYeuCauKho key={c.key} cot={c.key} r={r} onLapPhieu={openFulfil} />)}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CuonLuoi>
        {/* Về trang 1 ngay trong cùng lượt đổi cỡ — khỏi một lượt nạp thừa trước khi effect reset chạy. */}
        {!error && total > 0 && (
          <PhanTrangDayDu trang={page} size={pageSize} tong={total} soDong={pageRequests.length}
            onTrang={setPage} onSize={(n) => { setPageSize(n); setPage(1); }} loading={loading}
            donVi={donVi}
            ariaLabel={dieuChuyen ? "Phân trang phiếu điều chuyển" : "Phân trang phiếu từ yêu cầu"} />
        )}
      </div>

      {openRequest != null && token && (
        <InboxRequestDrawer
          key={`inbox-${openRequest}`}
          token={token}
          khoId={khoId}
          requestId={openRequest}
          canCreate={canCreate}
          canViewStock={canViewStock}
          canViewCost={canViewCost}
          onClose={() => setOpenRequest(null)}
          onCreateVoucher={openFulfil}
          onOpenVoucher={setOpenVoucher}
          onChanged={load}
          taiLai={taiNgan}
        />
      )}

      {creatingFor && token && khoId != null && (
        <VoucherCreateDrawer
          key={`mk-${creatingFor.id}`}
          token={token}
          request={creatingFor}
          khoList={khoList}
          initialKhoId={khoId}
          onClose={() => setCreatingFor(null)}
          onSaved={() => {
            setCreatingFor(null);
            load();
          }}
        />
      )}

      {openVoucher != null && token && (
        <VoucherDrawer
          key={`v-${openVoucher}`}
          token={token}
          voucherId={openVoucher}
          canCreate={canCreate}
          canPost={canPost}
          canViewCost={canViewCost}
          onClose={() => setOpenVoucher(null)}
          onChanged={() => {
            load();
            setTaiNgan((n) => n + 1);
          }}
          tang={openRequest != null ? 1 : 0}
        />
      )}

      {dieuChuyen && openTransfer != null && token && (
        <TransferDrawer
          key={`tr-${openTransfer}`}
          token={token}
          requestId={openTransfer}
          canCreate={canCreate}
          canViewCost={canViewCost}
          onClose={() => setOpenTransfer(null)}
          onChanged={load}
        />
      )}
    </>
  );
}

// ── Lưới danh sách (khuôn chung 08/10/2026) ───────────────────────────────────
// Phiếu từ yêu cầu: Mã, Ngày tạo, Loại, Vật tư, Nguồn, Tiến độ, Cần lúc, Trạng thái, Người yêu cầu,
// Công đoạn, Bộ phận, Thao tác.
interface CotKho extends CotLuoi { w?: number; n?: boolean }
const COT_YCK: CotKho[] = [
  { key: "ma", label: "Mã yêu cầu", coDinh: true, w: 120 },
  { key: "ngay", label: "Ngày tạo", w: 104 },
  { key: "loai", label: "Loại", w: 104 },
  { key: "vattu", label: "Vật tư", w: 250 },
  { key: "nguon", label: "Nguồn", w: 180 },
  { key: "tiendo", label: "Tiến độ", w: 170 },
  { key: "can", label: "Cần lúc", w: 150 },
  { key: "tt", label: "Trạng thái", w: 150 },
  { key: "nguoi", label: "Người yêu cầu", w: 150 },
  { key: "congdoan", label: "Công đoạn", w: 150 },
  { key: "bophan", label: "Bộ phận", w: 150 },
  { key: "nut", label: "Thao tác", coDinh: true, w: 130 },
];

/** Điều chuyển: Mã, Ngày tạo, Tuyến, Trạng thái, Tổng giá vốn (khi thấy giá), Số dòng, Thao tác. */
const COT_DC: CotKho[] = [
  { key: "ma", label: "Mã", coDinh: true, w: 150 },
  { key: "ngay", label: "Ngày tạo", w: 104 },
  { key: "tuyen", label: "Tuyến", w: 280 },
  { key: "tt", label: "Trạng thái", w: 150 },
  { key: "giavon", label: "Tổng giá vốn", w: 140, n: true },
  { key: "sodong", label: "Số dòng", w: 90, n: true },
  { key: "nut", label: "Thao tác", coDinh: true, w: 110 },
];

/** Chấm màu của hàng lọc nhanh (theo nhóm trạng thái). */
const MAU_TAB: Record<TabId, MauTT | undefined> = {
  "tat-ca": undefined,
  "can-cap": "cam",
  done: "la",
  "da-huy": "xam",
};

function OYeuCauKho({ cot, r, onLapPhieu }: { cot: string; r: StockRequest; onLapPhieu: (r: StockRequest) => void }) {
  switch (cot) {
    case "ma":
      return <td title={r.ma}>{r.ma}</td>;
    case "ngay":
      return <td title={fmtDateTime(r.created_at)}>{fmtDate(r.created_at)}</td>;
    case "loai":
      return <td><ChipLoaiYeuCau loai={r.loai} dieuChuyen={r.dieu_chuyen} /></td>;
    case "vattu": {
      const ten = r.lines[0]?.hang_ten ?? "—";
      const them = r.lines.length - 1;
      return (
        <td title={ten}>
          <span className="kho-vt">
            <span className="kho-vt__ten">{ten}</span>
            {them > 0 && <span className="lds-tag">+{them} mặt hàng</span>}
          </span>
        </td>
      );
    }
    case "nguon":
      // Đơn mua + đợt (nhập từ Mua hàng), KCS + lệnh, điều chuyển, hoặc LỆNH cần hàng (mg 0175 — thủ
      // kho gom các yêu cầu của cùng một lệnh mà soạn một lượt).
      return <td><NguonA r={r} /></td>;
    case "tiendo":
      return <td><TienDoA r={r} /></td>;
    case "can": {
      // GIỜ cần thật (từ đề nghị sản xuất) ưu tiên trước — `ngay_can` chỉ có DATE.
      const canLuc = canLucCua(r);
      if (!canLuc) return <td className="lds-mu">Chưa hẹn</td>;
      const quaHan = isOverdue(r.ngay_can, r.trang_thai, r.can_luc);
      return quaHan
        ? <td className="lds-do" title="Quá hạn">{canLuc}<span className="lds-u">Quá hạn</span></td>
        : <td>{canLuc}</td>;
    }
    case "tt":
      return <td><ChipTrangThaiYeuCau status={r.trang_thai} loai={r.loai} /></td>;
    case "nguoi":
      return <td title={r.nguoi_tao_ten ?? undefined}>{r.nguoi_tao_ten ?? "—"}</td>;
    case "congdoan":
      // Yêu cầu SINH TỪ đề nghị cấp vật tư công đoạn → thủ kho biết đang soạn cho khâu nào
      // (task-8-ruling-man-kho).
      return r.san_xuat_cong_doan_ten
        ? <td title={r.san_xuat_cong_doan_ten}>{r.san_xuat_cong_doan_ten}</td>
        : <td className="lds-mu">—</td>;
    case "bophan":
      return r.bo_phan_ten ? <td title={r.bo_phan_ten}>{r.bo_phan_ten}</td> : <td className="lds-mu">—</td>;
    case "nut": {
      const daCo = r.lines.some((l) => l.sl_da_ung > 0);
      return (
        <td className="lds-nut" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          {FULFILLABLE.includes(r.trang_thai) && (
            <button type="button" className={r.open_voucher_id != null || daCo ? "lds-btn" : "btn btn--accent"}
              onClick={() => onLapPhieu(r)}>
              {r.open_voucher_id != null ? "Xem phiếu" : daCo ? "Lập phiếu tiếp" : "Lập phiếu"}
            </button>
          )}
        </td>
      );
    }
    default:
      return <td />;
  }
}

/** Trạng thái PHIẾU ĐIỀU CHUYỂN suy từ yêu cầu NHẬP đích: hủy → da-huy · hoàn tất → hoan-tat ·
 *  còn phiếu nháp chờ ghi sổ → cho-ghi-so. */
function transferStatusOf(r: StockRequest): TransferStatus {
  if (r.trang_thai === "cancelled") return "da-huy";
  if (r.trang_thai === "done") return "hoan-tat";
  return "cho-ghi-so";
}

function ODieuChuyen({ cot, r, moi, canViewCost, onMo }: {
  cot: string; r: StockRequest; moi: boolean; canViewCost: boolean; onMo: () => void;
}) {
  switch (cot) {
    case "ma":
      return <td title={r.ma}>{r.ma}{moi && <span className="lds-tag">Mới</span>}</td>;
    case "ngay":
      return <td title={fmtDateTime(r.created_at)}>{fmtDate(r.created_at)}</td>;
    case "tuyen": {
      const tuyen = `${r.kho_nguon_ten ?? "—"} ⇄ ${r.kho_ten ?? "—"}`;
      return <td title={tuyen}>{tuyen}</td>;
    }
    case "tt":
      return <td><ChipTrangThaiDieuChuyen status={transferStatusOf(r)} /></td>;
    case "giavon":
      return canViewCost
        ? <td className="n">{soVN(r.lines.reduce((s, l) => s + (l.don_gia ?? 0) * l.sl_duyet, 0))}</td>
        : <td />;
    case "sodong":
      return <td className="n">{r.lines.length}</td>;
    case "nut":
      return (
        <td className="lds-nut" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          <button type="button" className={r.open_voucher_id == null ? "lds-btn" : "btn btn--accent"} onClick={onMo}>
            {r.open_voucher_id != null ? "Ghi sổ" : "Xem"}
          </button>
        </td>
      );
    default:
      return <td />;
  }
}

export function TransferDrawer({
  token,
  requestId,
  canCreate,
  canViewCost,
  onClose,
  onChanged,
}: {
  token: string;
  requestId: number;
  canCreate: boolean;
  canViewCost: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  useNapTenDonVi();
  const [req, setReq] = useState<StockRequest | null>(null);
  const [v, setV] = useState<StockVoucher | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [askPost, setAskPost] = useState(false);
  const [askCancel, setAskCancel] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [popupBlocked, setPopupBlocked] = useState(false);
  // Vị trí cất lô khai TRƯỚC ghi sổ (phiếu điều chuyển đích không có form nhập) — keyed theo line id.
  const [viTriEdit, setViTriEdit] = useState<Record<number, string>>({});

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.kho.deNghi
      .get(token, requestId)
      .then(async (r) => {
        if (cancelled) return;
        setReq(r);
        // Phiếu NHẬP đích: còn chờ ghi sổ thì có `open_voucher_id`; đã ghi sổ / đã hủy thì null →
        // truy lại qua list (request_id + loai NHAP) để vẫn hiện được các dòng theo lô.
        let voucherId = r.open_voucher_id;
        if (voucherId == null) {
          const list = await api.kho.phieu
            .list(token, { request_id: requestId, loai: "NHAP", size: 5 })
            .catch(() => null);
          voucherId = list?.items[0]?.id ?? null;
        }
        if (voucherId != null) {
          const voucher = await api.kho.phieu.get(token, voucherId).catch(() => null);
          if (!cancelled) setV(voucher);
        }
      })
      .catch((e) =>
        setError(e instanceof ApiError ? e.message : "Không tải được phiếu điều chuyển."),
      )
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, requestId]);

  // Nạp vị trí sẵn có của dòng phiếu vào ô sửa (điều chuyển đích thường trống tới khi thủ kho khai).
  useEffect(() => {
    if (!v) return;
    const init: Record<number, string> = {};
    v.lines.forEach((l) => {
      init[l.id] = l.vi_tri ?? "";
    });
    setViTriEdit(init);
  }, [v]);

  // Gợi ý vị trí cất (kệ/ô) đã khai của kho ĐÍCH — chỉ để GỢI Ý (datalist), vẫn gõ tự do được.
  const [viTriOptions, setViTriOptions] = useState<string[]>([]);
  useEffect(() => {
    const kho = v?.kho_id;
    if (kho == null) { setViTriOptions([]); return; }
    let alive = true;
    api.kho.viTri.list(token, kho)
      .then((r) => { if (alive) setViTriOptions(r.items.map((x) => x.ma)); })
      .catch(() => { if (alive) setViTriOptions([]); });
    return () => { alive = false; };
  }, [token, v?.kho_id]);

  const status: TransferStatus =
    req?.trang_thai === "cancelled"
      ? "da-huy"
      : v?.trang_thai === "posted" || req?.trang_thai === "done"
        ? "hoan-tat"
        : "cho-ghi-so";
  // Ghi sổ / Hủy chỉ khi CHƯA ghi sổ (còn phiếu nháp đích) — đã ghi sổ/hủy → chỉ đọc.
  const canAct =
    canCreate && req != null && req.open_voucher_id != null && req.trang_thai !== "cancelled";

  function ghiSo() {
    if (!v) return;
    setBusy(true);
    setError(null);
    // Lưu VỊ TRÍ đã khai (nếu có) TRƯỚC khi ghi sổ → ghi sổ chép sang lô. Một nhịp thao tác.
    const viTriLines = v.lines.map((l) => ({
      line_id: l.id,
      vi_tri: (viTriEdit[l.id] ?? "").trim() || null,
    }));
    api.kho.phieu
      .suaViTriDong(token, v.id, viTriLines)
      .then(() => api.kho.phieu.ghiSo(token, v.id))
      .then(() => {
        onChanged();
        onClose();
      })
      .catch((e) => {
        setAskPost(false);
        setBusy(false);
        setError(e instanceof ApiError ? e.message : "Không ghi sổ được phiếu.");
      });
  }

  function huy() {
    const ly = cancelReason.trim();
    if (!ly) return;
    setBusy(true);
    setError(null);
    api.kho.dieuChuyen
      .huy(token, requestId, ly)
      .then(() => {
        onChanged();
        onClose();
      })
      .catch((e) => {
        setAskCancel(false);
        setBusy(false);
        setError(e instanceof ApiError ? e.message : "Không hủy được phiếu điều chuyển.");
      });
  }

  function doPrint() {
    if (!req) return;
    // Mẫu điều chuyển RIÊNG (Từ kho → Đến kho + HSD), không phải 01-VT/02-VT. Dòng lấy từ phiếu
    // NHẬP đích (per-lô + giá vốn + HSD). Giá vốn null khi thiếu quyền → bản in tự bỏ 2 cột tiền.
    const data: TransferPrintData = {
      docNo: req.ma,
      docDate: v ? v.ngay : (req.created_at ? ngayVN(req.created_at) : null),
      khoNguon: req.kho_nguon_ten,
      khoDich: req.kho_ten,
      nguoiLap: v?.nguoi_lap_ten ?? req.nguoi_tao_ten ?? null,
      nguoiGiaoNhan: v?.nguoi_giao_nhan ?? null,
      lyDo: v?.ghi_chu ?? req.ghi_chu ?? null,
      // In ẩn GIÁ nghiêm theo quyền `view_cost` (không dựa API — API còn nới cho người tạo yêu cầu).
      tongTien: canViewCost ? (v?.gia_von ?? null) : null,
      cancelled: req.trang_thai === "cancelled",
      lines: (v?.lines ?? []).map((l) => ({
        materialCode: l.hang_ma,
        materialName: l.hang_ten,
        dvt: tenDonVi(l.dvt) ?? l.dvt,
        soLuong: l.so_luong,
        donGia: canViewCost ? l.don_gia : null,
        thanhTien: canViewCost ? l.thanh_tien : null,
        hsd: l.hsd ?? null,
      })),
    };
    setPopupBlocked(!printTransferVoucher(data));
  }

  return (
    <>
      <div className="rc-drawer__scrim" role="dialog" aria-modal="true" onClick={onClose}>
        <aside className="rc-drawer rc-drawer--wide" onClick={(e) => e.stopPropagation()}>
          <header className="rc-drawer__head">
            <div>
              <div className="rc-drawer__kicker">PHIẾU ĐIỀU CHUYỂN</div>
              <h2 className="rc-drawer__title">{req?.ma ?? "Đang tải…"}</h2>
            </div>
            <div className="kho-headside">
              {req && <TransferStatusBadge status={status} />}
              <button type="button" className="rc-drawer__x" onClick={onClose} aria-label="Đóng">
                <Icon name="x" size={16} />
              </button>
            </div>
          </header>

          <div className="rc-drawer__body">
            {error && (
              <div className="banner banner--error" role="alert">
                <span>{error}</span>
              </div>
            )}
            {popupBlocked && (
              <div className="banner banner--warn" role="alert">
                <span>Trình duyệt đã chặn cửa sổ in. Cho phép pop-up cho trang này rồi bấm In lại.</span>
              </div>
            )}
            {loading || !req ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
                {Array.from({ length: 4 }).map((_, i) => (
                  <span key={i} className="rc-skel" style={{ width: `${90 - i * 12}%` }} />
                ))}
              </div>
            ) : (
              <>
                {req.trang_thai === "cancelled" && req.ly_do_huy && (
                  <div className="banner banner--warn" role="status">
                    <span>
                      <b>Đã hủy</b> — Lý do: {req.ly_do_huy}
                    </span>
                  </div>
                )}

                <section className="rc-sec">
                  <h3 className="rc-sec__title">Tuyến điều chuyển</h3>
                  <div className="kho-info-grid">
                    <div className="kho-info-item">
                      <span className="kho-info-item__label">Từ kho (nguồn)</span>
                      <div className="kho-info-item__val" style={{ fontWeight: 600, color: "var(--moss-deep, #1e3a29)" }}>
                        {req.kho_nguon_ten ?? "—"}
                      </div>
                    </div>
                    <div className="kho-info-item">
                      <span className="kho-info-item__label">Đến kho (nhập về)</span>
                      <div className="kho-info-item__val" style={{ fontWeight: 600, color: "var(--steel-deep, #1e293b)" }}>
                        {req.kho_ten ?? "—"}
                      </div>
                    </div>
                    <div className="kho-info-item">
                      <span className="kho-info-item__label">Ngày</span>
                      <div className="kho-info-item__val">
                        {v ? fmtDateISO(v.ngay) : fmtDate(req.created_at)}
                      </div>
                    </div>
                    <div className="kho-info-item">
                      <span className="kho-info-item__label">Số CT phiếu nhập</span>
                      <div className="kho-info-item__val">
                        {v?.ma ? <span className="rc__code-badge">{v.ma}</span> : "—"}
                      </div>
                    </div>
                    <div className="kho-info-item">
                      <span className="kho-info-item__label">Người tạo</span>
                      <div className="kho-info-item__val">
                        {req.nguoi_tao_ten ?? "—"}
                        {req.bo_phan_ten ? ` (${req.bo_phan_ten})` : ""}
                      </div>
                    </div>
                    <div className="kho-info-item">
                      <span className="kho-info-item__label">Tạo lúc</span>
                      <div className="kho-info-item__val">{fmtDateTime(req.created_at)}</div>
                    </div>
                  </div>
                </section>

                <div className="banner banner--info">
                  <span>Ghi sổ sẽ <b>TRỪ</b> kho nguồn và <b>CỘNG</b> kho đích cùng lúc.</span>
                </div>

                <section className="rc-sec">
                  <h3 className="rc-sec__title">Dòng điều chuyển (theo lô)</h3>
                  {viTriOptions.length > 0 && (
                    <datalist id="kho-vitri-transfer">
                      {viTriOptions.map((x) => <option key={x} value={x} />)}
                    </datalist>
                  )}
                  <div className="lds-bang lds-bang--nhap">
                    <table className="lds-g">
                      <colgroup>
                        <col />
                        <col style={{ width: 120 }} />
                        {canViewCost && <col style={{ width: 110 }} />}
                        {canViewCost && <col style={{ width: 120 }} />}
                        <col style={{ width: 100 }} />
                        <col style={{ width: 190 }} />
                      </colgroup>
                      <thead>
                        <tr>
                          <th>Vật tư</th>
                          <th className="n">Số lượng</th>
                          {canViewCost && <th className="n">Giá vốn</th>}
                          {canViewCost && <th className="n">Thành tiền</th>}
                          <th>HSD</th>
                          <th>Vị trí</th>
                        </tr>
                      </thead>
                      <tbody>
                        {!v || v.lines.length === 0 ? (
                          <tr>
                            <td colSpan={canViewCost ? 6 : 4} className="lds-trong">
                              <i>Không có dòng nào.</i>
                            </td>
                          </tr>
                        ) : (
                          v.lines.map((l) => (
                            <tr key={l.id}>
                              <td>
                                <div>{l.hang_ten ?? "—"}</div>
                                <div className="kho-lines__code" style={{ fontSize: 12, color: "var(--ash-2)" }}>{l.hang_ma ?? ""}</div>
                                {nhanKhoGiay(l) && (
                                  <div className="kho-lines__code" style={{ fontSize: 12 }}>{nhanKhoGiay(l)}</div>
                                )}
                              </td>
                              <td className="n">
                                {fmtQty(l.so_luong)} {tenDonVi(l.dvt) ?? l.dvt ?? ""}
                              </td>
                              {canViewCost && (
                                <td className="n">
                                  {l.don_gia != null ? money(l.don_gia) : "—"}
                                </td>
                              )}
                              {canViewCost && (
                                <td className="n">
                                  {l.thanh_tien != null ? money(l.thanh_tien) : "—"}
                                </td>
                              )}
                              <td>{l.hsd ? fmtDateISO(l.hsd) : "—"}</td>
                              <td>
                                {canAct ? (
                                  <input
                                    className="rc-input"
                                    style={{ width: "100%" }}
                                    value={viTriEdit[l.id] ?? ""}
                                    list={viTriOptions.length > 0 ? "kho-vitri-transfer" : undefined}
                                    onChange={(e) =>
                                      setViTriEdit((m) => ({ ...m, [l.id]: e.target.value }))
                                    }
                                    placeholder="kệ / ô…"
                                  />
                                ) : (
                                  l.vi_tri ?? "—"
                                )}
                              </td>
                            </tr>
                          ))
                        )}
                        {v && v.lines.length > 0 && (
                          <tr className="lds-cong">
                            <td style={{ textAlign: "right" }}>Tổng cộng ({v.lines.length} dòng):</td>
                            <td className="n">
                              {fmtQty(v.lines.reduce((s, l) => s + (l.so_luong ?? 0), 0))}
                            </td>
                            {canViewCost && <td className="n">—</td>}
                            {canViewCost && (
                              <td className="n">
                                {money(v.lines.reduce((s, l) => s + (l.thanh_tien ?? 0), 0))}
                              </td>
                            )}
                            <td colSpan={2}></td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>
              </>
            )}
          </div>

          <footer className="rc-drawer__foot">
            {canAct && (
              <Button variant="accent" loading={busy} onClick={() => setAskPost(true)}>
                Ghi sổ
              </Button>
            )}
            {canAct && (
              <button
                type="button"
                className="btn btn--danger"
                onClick={() => {
                  setCancelReason("");
                  setAskCancel(true);
                }}
              >
                Hủy
              </button>
            )}
            {/* In được ở MỌI trạng thái (kể cả Chờ ghi sổ / Hoàn tất / Đã hủy) — bản giấy làm chứng
                từ đi đường. Cần phiếu đích (`v`) đã tải để có dòng theo lô. */}
            {v && (
              <button type="button" className="btn btn--secondary" onClick={doPrint}>
                In phiếu
              </button>
            )}
            <button type="button" className="btn btn--secondary" onClick={onClose}>
              Đóng
            </button>
          </footer>
        </aside>
      </div>

      <ConfirmDialog
        open={askPost}
        title="Ghi sổ phiếu điều chuyển?"
        message="Tồn kho nguồn sẽ TRỪ và kho đích sẽ CỘNG cùng lúc — phiếu không sửa được nữa."
        confirmLabel="Ghi sổ"
        busy={busy}
        onCancel={() => setAskPost(false)}
        onConfirm={ghiSo}
      />

      <ConfirmDialog
        open={askCancel}
        title="Hủy phiếu điều chuyển này?"
        message="Cả phiếu điều chuyển sẽ bị hủy kèm lý do. Chỉ hủy được khi CHƯA ghi sổ."
        confirmLabel="Hủy phiếu"
        cancelLabel="Giữ lại"
        danger
        busy={busy}
        confirmDisabled={!cancelReason.trim()}
        onCancel={() => setAskCancel(false)}
        onConfirm={huy}
      >
        <label className="rc-field">
          <span className="rc-field__label">
            Lý do hủy <em>*</em>
          </span>
          <textarea
            className="rc-textarea"
            rows={3}
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            placeholder="Vì sao hủy điều chuyển này? (bắt buộc)"
            autoFocus
          />
        </label>
      </ConfirmDialog>
    </>
  );
}

// ── DRAWER: chi tiết yêu cầu (góc nhìn KHO, và người xin xem yêu cầu của mình) ──
//
// Khuôn A (07/10/2026, docs/mockups/yeu-cau-nhap-xuat-phuong-an-A.html): vỏ `NganPhai`, tab Chi tiết
// | Lịch sử. Cột chính = thẻ Vật tư (Yêu cầu / Đã cấp / Còn thiếu / Tồn / Tiền) + thẻ Phiếu kho; cột
// bên = thẻ Yêu cầu, Nguồn hàng, Ghi chú người tạo. Bỏ stepper, dải KPI, dòng meta và mục "Kho phản
// hồi" — mỗi thông tin chỉ nói một lần.

export function InboxRequestDrawer({
  token,
  khoId,
  requestId,
  canCreate,
  canViewStock,
  canViewCost,
  onClose,
  onCreateVoucher,
  onOpenVoucher,
  onChanged,
  tang,
  thaoTac,
  taiLai = 0,
}: {
  token: string;
  khoId: number | null;
  requestId: number;
  canCreate: boolean;
  canViewStock: boolean;
  /** Kế toán (view_cost) xem ĐƠN GIÁ + THÀNH TIỀN của dòng yêu cầu; không quyền thì cột biến mất. */
  canViewCost: boolean;
  onClose: () => void;
  onCreateVoucher: (r: StockRequest) => void;
  /** Mở phiếu ĐÃ lập từ yêu cầu này (kể cả đã ghi sổ) — cha có sẵn VoucherDrawer. Không truyền
   *  (vd popup chỉ-đọc) → hàng phiếu không bấm được. */
  onOpenVoucher?: (voucherId: number) => void;
  /** Gọi khi yêu cầu đổi trạng thái (kho hủy) để cha refetch list ngay. */
  onChanged?: () => void;
  /** Lớp chồng (0 = ngăn thường). */
  tang?: number;
  /** Nút thêm ở đầu ngăn theo vai người xem (vd người xin: "Tạo lại từ yêu cầu này"). */
  thaoTac?: (r: StockRequest) => ReactNode;
  /** Tăng lên mỗi khi phiếu mở chồng trên ngăn này đổi số (điều chỉnh/hủy/ghi sổ) → nạp lại. */
  taiLai?: number;
}) {
  // Nhãn ĐVT phải là TÊN có dấu lấy từ danh mục ("bản kẽm"), KHÔNG phải mã lưu trong
  // `stock_request_lines.dvt` ("kem") — mã vẫn giữ nguyên khi gửi lên server để quy đổi.
  useNapTenDonVi();
  const [req, setReq] = useState<StockRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"chi-tiet" | "lich-su">("chi-tiet");
  const can = useCan();
  // Cột tồn đi theo DÒNG KHO của chính yêu cầu (`ton_kho_<id>`, 05/10/2026) — khớp máy chủ
  // (`kho_request.py` chỉ điền `ton_kha_dung` cho người xem được kho đó). Chưa chọn kho thì theo cha.
  const xemTon = req?.kho_id != null ? can(khoaTonKho(req.kho_id), "read") : canViewStock;
  // Phiếu đã lập từ yêu cầu này (chờ ghi sổ / đã ghi sổ) — xem lại kể cả khi yêu cầu đã Hoàn tất.
  const [vouchers, setVouchers] = useState<StockVoucher[]>([]);
  // Kho HỦY yêu cầu (quyết không cấp) — kèm lý do bắt buộc.
  const [askCancel, setAskCancel] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => {
    setLoading(true);
    api.kho.deNghi
      .get(token, requestId, khoId)
      .then((r) => {
        setReq(r);
        setError(null);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Không tải được yêu cầu."))
      .finally(() => setLoading(false));
    api.kho.phieu
      .list(token, { request_id: requestId, size: 50 })
      .then((p) => setVouchers(p.items))
      .catch(() => {});
  }, [token, requestId, khoId]);

  useEffect(reload, [reload]);
  // Phiếu chồng phía trên vừa đổi số → số "Đã cấp", tồn, lịch sử ở ngăn dưới phải theo kịp.
  const daTai = useRef(taiLai);
  useEffect(() => {
    if (daTai.current === taiLai) return;
    daTai.current = taiLai;
    reload();
  }, [taiLai, reload]);

  const canFulfill = canCreate && req != null && FULFILLABLE.includes(req.trang_thai);
  const nhap = req?.loai === "NHAP";
  const dongYc = req?.lines ?? [];
  // Giá bán (tham khảo) — CỘT RIÊNG, chỉ dựng khi có dòng thành phẩm mang giá bán.
  const hienGiaBan = canViewCost && dongYc.some((l) => l.don_gia_ban != null);
  // Một đơn bán thì thẻ Nguồn hàng đã ghi — ô Giá bán khỏi lặp mã đơn; nhiều đơn mới ghi từng dòng.
  const nhieuDonBan = new Set(dongYc.map((l) => l.don_ban_ma).filter(Boolean)).size > 1;
  // Thành phẩm KCS chưa có giá gốc hiện chip "Chưa có giá gốc" — cột phải đủ rộng cho chip, khỏi cắt chữ.
  const rongGia = dongYc.some((l) => l.tu_kcs) ? 96 : 90;
  // Cột tiền chỉ dựng khi máy chủ THẬT SỰ trả số (yêu cầu xuất không mang đơn giá — giá vốn nằm ở phiếu).
  const hienTien = canViewCost && dongYc.some((l) => l.don_gia != null || l.tu_kcs);
  // Yêu cầu nhập từ đợt giao đơn mua: dòng mang "Mua cho" (tồn kho / theo yêu cầu / lệnh nào) suy
  // từ yêu cầu mua gốc (08/10/2026). Yêu cầu xuất vẫn là cột "Cho lệnh" như cũ.
  const hienMuaCho = dongYc.some((l) => (l.loai_mua_cac?.length ?? 0) > 0);
  // Yêu cầu từ KCS chỉ một lệnh: thẻ Nguồn hàng đã ghi lệnh ⇒ bỏ cột, nhường chỗ cho bảng khỏi cuộn ngang.
  const motLenhKcs = dongYc.some((l) => l.tu_kcs) && new Set(dongYc.map((l) => l.lsx_ma)).size === 1;
  const hienLenh = hienMuaCho || (!motLenhKcs && dongYc.some((l) => l.lsx_ma || l.bai_ghep_ma));
  // Cột tồn chỉ cho yêu cầu XUẤT: kho đang nhận hàng thì tồn không phải câu hỏi.
  const hienTon = xemTon && !nhap;
  const dongMo = req != null && FULFILLABLE.includes(req.trang_thai);
  const soDu = dongYc.filter(dongDu).length;
  const tongTien = hienTien
    ? dongYc.reduce((s, l) => s + (l.tu_kcs ? l.tien_goc ?? 0 : Math.round((l.don_gia ?? 0) * l.sl_de_nghi)), 0)
    : 0;
  const soCot = 4 + (hienLenh ? 1 : 0) + (hienTon ? 1 : 0) + (hienTien ? 2 : 0) + (hienGiaBan ? 1 : 0);
  const tre = req ? isOverdue(req.ngay_can, req.trang_thai, req.can_luc) : false;
  const canLuc = req ? canLucCua(req) : null;

  const kicker = req?.dieu_chuyen ? "Yêu cầu điều chuyển" : nhap ? "Yêu cầu nhập kho" : "Yêu cầu xuất kho";
  const daCo = vouchers.some((v) => v.trang_thai === "posted");

  return (
    <>
      <NganPhai
        tang={tang}
        duongDan={<span>{req ? kicker : "Yêu cầu kho"}</span>}
        tieuDe={req?.ma ?? "Đang tải…"}
        the={req ? <RequestStatusBadge status={req.trang_thai} loai={req.loai} /> : undefined}
        hanhDong={
          req ? (
            <>
              {/* Kho quyết KHÔNG cấp → hủy kèm lý do (gate `create` như backend). Ẩn khi đã có phiếu
                  đang mở (lúc đó xử lý ở phiếu), tránh hủy chồng lên phiếu. */}
              {canFulfill && req.open_voucher_id == null && (
                <button type="button" className="kna-nut kna-nut--nhat kna-nut--do" onClick={() => setAskCancel(true)}>
                  Hủy yêu cầu
                </button>
              )}
              {thaoTac?.(req)}
              {/* Kho đi thẳng "Chờ xử lý → Lập phiếu"; phiếu tự chuyển yêu cầu sang "đang chuẩn bị". */}
              {canFulfill && (
                <button type="button" className={`kna-nut${req.open_voucher_id != null ? "" : " kna-nut--chinh"}`}
                  onClick={() => onCreateVoucher(req)}>
                  {req.open_voucher_id != null ? (
                    "Xem phiếu chờ ghi sổ"
                  ) : (
                    <><Plus size={16} aria-hidden="true" />{nhap ? (daCo ? "Lập phiếu nhập tiếp" : "Lập phiếu nhập") : daCo ? "Lập phiếu cấp tiếp" : "Lập phiếu xuất"}</>
                  )}
                </button>
              )}
            </>
          ) : undefined
        }
        tabs={[
          { id: "chi-tiet", nhan: "Chi tiết" },
          { id: "lich-su", nhan: "Lịch sử" },
        ]}
        tab={tab}
        onTab={(id) => setTab(id as typeof tab)}
        onDong={onClose}
      >
        <div className="kna">
          {error && (
            <div className="banner banner--error" role="alert">
              <span>{error}</span>
            </div>
          )}
          {loading && !req ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
              {Array.from({ length: 4 }).map((_, i) => (
                <span key={i} className="rc-skel" style={{ width: `${90 - i * 12}%` }} />
              ))}
            </div>
          ) : !req ? null : tab === "lich-su" ? (
            <LichSuA muc={lichSuYeuCau(req, vouchers, onOpenVoucher)} />
          ) : (
            <>
              {req.trang_thai === "cancelled" && req.ly_do_huy && (
                <div className="kna-canh" role="status">
                  <AlertTriangle size={16} aria-hidden="true" />
                  <span><b>Đã hủy.</b> {req.ly_do_huy}</span>
                </div>
              )}
              {req.trang_thai === "rejected" && req.ly_do_tu_choi && (
                <div className="kna-canh kna-canh--do" role="alert">
                  <AlertTriangle size={16} aria-hidden="true" />
                  <span><b>Bị từ chối.</b> {req.ly_do_tu_choi}</span>
                </div>
              )}
              <div className="kna-luoi">
                <div className="kna-cot">
                  <TheA cat tieuDe="Vật tư"
                    phai={dongYc.length > 1 && req.trang_thai !== "cancelled"
                      ? `${soDu}/${dongYc.length} mặt hàng đã ${nhap ? "nhập" : "cấp"} đủ` : undefined}>
                    <div className="lds-bang">
                      {/* Cột cố định cộng lại + 160 cho cột Vật tư: chật hơn bề ngang ngăn thì khung tự cuộn ngang. */}
                      {/* Ngăn rộng 1180px để bảng còn ~727px: cột hẹp vừa đủ chữ, Vật tư giữ tối thiểu 150px. */}
                      <table className="lds-g" style={{ minWidth: 150 + 244 + (hienLenh ? 120 : 0) + (hienTon ? 110 : 0) + (hienTien ? 104 + rongGia : 0) + (hienGiaBan ? 116 : 0) }}>
                        <colgroup>
                          <col />
                          {hienLenh && <col style={{ width: 120 }} />}
                          <col style={{ width: 84 }} />
                          <col style={{ width: 76 }} />
                          <col style={{ width: 84 }} />
                          {hienTon && <col style={{ width: 110 }} />}
                          {hienTien && <col style={{ width: rongGia }} />}
                          {hienTien && <col style={{ width: 104 }} />}
                          {hienGiaBan && <col style={{ width: 116 }} />}
                        </colgroup>
                        <thead>
                          <tr>
                            <th>Vật tư</th>
                            {hienLenh && <th>{hienMuaCho ? "Mua cho" : "Cho lệnh"}</th>}
                            <th className="n">Yêu cầu</th>
                            <th className="n">{nhap ? "Đã nhập" : "Đã cấp"}</th>
                            <th className="n">Còn thiếu</th>
                            {hienTon && <th className="n">Tồn khả dụng</th>}
                            {hienTien && <th className="n">{dongYc.some((l) => l.tu_kcs) ? "Giá gốc" : "Đơn giá"}</th>}
                            {hienTien && <th className="n">Thành tiền</th>}
                            {hienGiaBan && <th className="n">Giá bán</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {dongYc.map((l) => {
                            const dvYc = tenDv(l.dvt);
                            // `ton_kha_dung` ở ĐƠN VỊ GỐC (Σ sl_con_lai lô), còn `sl_con_lai` (dòng yêu cầu)
                            // ở đơn vị YÊU CẦU → quy về gốc rồi mới so thiếu/đủ, không thì trừ chéo đơn vị
                            // (70 tờ − 1 ram). `sl_con_lai` đã tính theo số kho CHỐT (điều chỉnh xuất) —
                            // một đường tính duy nhất ở `StockRequestService.con_lai`.
                            const dvGoc = tenDv(l.don_vi_goc ?? l.dvt);
                            const heSoVeGoc = l.sl_quy_doi && l.sl_de_nghi ? l.sl_quy_doi / l.sl_de_nghi : 1;
                            const thieuTon = (l.sl_con_lai || 0) * heSoVeGoc - (l.ton_kha_dung || 0);
                            const isShort = l.sl_con_lai > 0 && l.ton_kha_dung != null && thieuTon > 1e-6;
                            const du = dongDu(l);
                            return (
                              <Fragment key={l.id}>
                                <tr>
                                  <td>
                                    <HangA ten={l.hang_ten ?? "—"} anh={l.hang_anh ? anhNho(l.hang_anh) : null}
                                      phu={<>
                                        {l.hang_ma && <span className="kna-tag kna-tag--ma">{l.hang_ma}</span>}
                                        {nhanKhoGiay(l) && <span>{nhanKhoGiay(l)}</span>}
                                      </>} />
                                  </td>
                                  {hienLenh && (
                                    <td>
                                      {l.loai_mua_cac?.length ? (
                                        <OMuaCho loai={l.loai_mua_cac} lenh={l.mua_cho} />
                                      ) : (
                                        l.lsx_ma ?? l.bai_ghep_ma ?? <span className="kna-mo">—</span>
                                      )}
                                    </td>
                                  )}
                                  <td className="n">
                                    <SoA so={l.sl_de_nghi} dv={dvYc} />
                                    {/* Người duyệt đã hạ số duyệt khác số xin thì mục tiêu thật là số duyệt. */}
                                    {l.sl_duyet !== l.sl_de_nghi && (
                                      <div className="kna-hang__phu" style={{ justifyContent: "flex-end" }}>Duyệt {fmtQty(l.sl_duyet)}</div>
                                    )}
                                  </td>
                                  <td className="n">
                                    <SoA so={l.sl_da_ung} dam />
                                    {/* Kho đã CHỐT thực xuất (điều chỉnh phiếu xuất) — mục tiêu hạ xuống bằng số chốt. */}
                                    {l.sl_chot_thuc_xuat != null && (
                                      <div className="kna-hang__phu" style={{ justifyContent: "flex-end" }}>
                                        <span className="kna-tag">Chốt thực xuất {fmtQty(l.sl_chot_thuc_xuat)}</span>
                                      </div>
                                    )}
                                  </td>
                                  <td className="n">
                                    {du ? (
                                      <span className="kna-chip kna-chip--la">Đủ</span>
                                    ) : dongMo ? (
                                      <SoA so={l.sl_con_lai} thieu />
                                    ) : (
                                      <span className="kna-mo">{fmtQty(l.sl_con_lai)}</span>
                                    )}
                                  </td>
                                  {hienTon && (
                                    <td className="n">
                                      {l.ton_kha_dung == null ? (
                                        <span className="kna-mo">—</span>
                                      ) : !du && l.ton_kha_dung <= 1e-9 ? (
                                        <span className="kna-chip kna-chip--do">Hết tồn</span>
                                      ) : (
                                        <>
                                          <SoA so={l.ton_kha_dung} dv={dvGoc} />
                                          {!du && dongMo && isShort && (
                                            <div className="kna-hang__phu" style={{ justifyContent: "flex-end" }}>
                                              <span className="kna-chip kna-chip--do">Thiếu {fmtQty(thieuTon)} {dvGoc}</span>
                                            </div>
                                          )}
                                        </>
                                      )}
                                    </td>
                                  )}
                                  {/* Thành phẩm KCS: `don_gia` dòng yêu cầu luôn 0 — giá gốc thật đọc ở lô
                                      (`gia_goc`, kế toán kho gõ sau), chưa có thì nói thẳng thay vì "0 đ". */}
                                  {hienTien && (
                                    <td className="n kna-so">
                                      {l.tu_kcs ? <GiaGocKcs gia={l.gia_goc} /> : l.don_gia != null ? money(l.don_gia) : <span className="kna-mo">—</span>}
                                    </td>
                                  )}
                                  {hienTien && (
                                    <td className="n kna-so">
                                      {l.tu_kcs
                                        ? l.tien_goc != null ? money(l.tien_goc) : <span className="kna-mo">Chưa tính</span>
                                        : l.don_gia != null ? money(Math.round(l.don_gia * l.sl_de_nghi)) : <span className="kna-mo">—</span>}
                                    </td>
                                  )}
                                  {hienGiaBan && (
                                    <td className="n kna-so">
                                      <GiaBanDong gia={l.don_gia_ban} dvt={l.dvt} donMa={nhieuDonBan ? l.don_ban_ma : null} />
                                    </td>
                                  )}
                                </tr>
                                {l.ly_do_thieu && (
                                  <tr className="lds-so">
                                    <td colSpan={soCot}>
                                      <div className="kna-ly">
                                        <AlertTriangle size={14} aria-hidden="true" />
                                        <span><b>Kho {nhap ? "nhập" : "cấp"} thiếu:</b> {l.ly_do_thieu}</span>
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </Fragment>
                            );
                          })}
                          {hienTien && (
                            <tr className="lds-cong">
                              <td colSpan={soCot - 1 - (hienGiaBan ? 1 : 0)}>Tổng tiền theo yêu cầu</td>
                              <td className="n kna-so">{money(tongTien)}</td>
                              {hienGiaBan && <td />}
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </TheA>

                  <TheA cat tieuDe="Phiếu kho">
                    {vouchers.length === 0 ? (
                      <div className="kna-the__trong">
                        {dongMo ? "Chưa lập phiếu nào." : "Không có phiếu kho nào."}
                      </div>
                    ) : (
                      <div style={{ marginTop: 8 }}>
                        {vouchers.map((v) => (
                          <button key={v.id} type="button" className="kna-phieu"
                            disabled={!onOpenVoucher} onClick={() => onOpenVoucher?.(v.id)}>
                            <IconPhieu />
                            <span className="kna-tag kna-tag--ma">{v.ma}</span>
                            <span className={`kna-loai kna-loai--${v.loai === "NHAP" ? "nhap" : "xuat"}`}>
                              {v.loai === "NHAP" ? "Nhập" : "Xuất"}
                            </span>
                            {v.kho_ten && <span className="kna-mo">{v.kho_ten}</span>}
                            <span className="kna-so">{fmtDateISO(v.ngay)}</span>
                            <span className="kna-phieu__dau">
                              <VoucherStatusBadge status={v.trang_thai} />
                              {onOpenVoucher && <ChevronRight size={16} aria-hidden="true" />}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </TheA>
                </div>

                <div className="kna-cot">
                  <TheA tieuDe="Yêu cầu">
                    <div className="kna-the__than">
                      <KvA dong={[
                        ["Người yêu cầu", req.nguoi_tao_ten ?? "—", req.bo_phan_ten ? <small>{req.bo_phan_ten}</small> : null],
                        req.san_xuat_cong_doan_ten ? ["Công đoạn", req.san_xuat_cong_doan_ten] : null,
                        ["Ngày tạo", <span className="kna-so">{fmtDateTime(req.created_at)}</span>],
                        !req.dieu_chuyen && [
                          nhap ? "Cần nhập lúc" : "Cần lúc",
                          canLuc ? <span className="kna-so">{canLuc}</span> : <span className="kna-mo">Chưa hẹn</span>,
                          tre ? <small className="kna-tre">Quá hạn</small> : null,
                        ],
                        req.dieu_chuyen ? ["Từ kho", req.kho_nguon_ten ?? "—"] : null,
                        req.kho_ten ? [req.dieu_chuyen ? "Đến kho" : nhap ? "Kho tiếp nhận" : "Kho cấp", req.kho_ten] : null,
                        req.loai_kho ? ["Loại nhập xuất", req.loai_kho] : null,
                      ]} />
                    </div>
                  </TheA>
                  <TheNguonHang r={req} />
                  <TheGiaoHang r={req} />
                  {req.ghi_chu && (
                    <TheA tieuDe="Ghi chú người tạo">
                      <div className="kna-the__than kna-ghi">{req.ghi_chu}</div>
                    </TheA>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </NganPhai>

      <ConfirmDialog
        open={askCancel}
        title="Hủy yêu cầu này?"
        message="Yêu cầu sẽ chuyển sang 'Đã hủy' kèm lý do và KHÔNG cấp nữa. Người yêu cầu sẽ thấy lý do."
        confirmLabel="Hủy yêu cầu"
        cancelLabel="Giữ lại"
        danger
        busy={busy}
        confirmDisabled={!cancelReason.trim()}
        onCancel={() => setAskCancel(false)}
        onConfirm={() => {
          const ly = cancelReason.trim();
          if (!ly) return;
          setBusy(true);
          api.kho.deNghi
            .cancelByKho(token, requestId, ly)
            .then(() => {
              setAskCancel(false);
              setCancelReason("");
              onChanged?.();
              onClose();
            })
            .catch((e) => setError(e instanceof ApiError ? e.message : "Không hủy được yêu cầu."))
            .finally(() => setBusy(false));
        }}
      >
        <label className="rc-field">
          <span className="rc-field__label">
            Lý do hủy <em>*</em>
          </span>
          <textarea
            className="rc-textarea"
            rows={3}
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            placeholder="Vì sao kho không cấp yêu cầu này? (bắt buộc)"
            autoFocus
          />
        </label>
      </ConfirmDialog>
    </>
  );
}

// ── DRAWER: LẬP PHIẾU (khối .kho-alloc theo từng dòng yêu cầu) ───────────────

interface LotPick {
  lot_id: number;
  ma_lo: string;
  /** Mã phiếu NHẬP đã đưa lô vào kho — hiển thị THAY mã lô kỹ thuật. Null = tồn đầu kỳ. */
  voucher_ma: string | null;
  ngay_nhap: string;
  hsd: string | null;
  vi_tri: string | null;
  /** Tồn còn lại CỦA LÔ. */
  sl_con_lai: number;
  so_luong: number;
  /** Giấy: khổ + đơn vị gốc của lô (hàng khác: "" · 0 · 0). */
  don_vi_goc: string;
  kho_rong: number;
  kho_dai: number;
  don_gia_nhap: number | null;
  /** Nguồn lô thành phẩm (đơn / khách) + cảnh báo khi lô thuộc đơn khác cùng khách. */
  order_ma: string | null;
  khach_hang: string | null;
  canh_bao: string | null;
  /** Thành phẩm KCS chưa có giá gốc — giá vốn phần lấy từ lô này chưa tính được. */
  chua_gia_goc: boolean;
}

interface AllocBlock {
  line: StockRequestLine;
  // Mặt hàng KẾ THỪA từ dòng yêu cầu — kho không đổi được, và không còn khối "hàng mới"
  // (siết 2026-08-08: mọi thứ nhập kho phải có sẵn trong danh mục gốc).
  matLabel: string;
  matCode: string | null;
  /** Ảnh minh hoạ mặt hàng ĐANG LƯU (từ danh mục). null = chưa có. */
  anh: string | null;
  /** Ảnh MỚI đang chờ (client-side) — chỉ tải lên danh mục khi LẬP PHIẾU. null = không đổi. */
  anhFile: File | null;
  /** Đánh dấu GỠ ảnh cũ khi lập phiếu (chỉ có tác dụng khi không kèm `anhFile`). */
  anhRemove: boolean;
  /** Hệ số về đơn vị gốc — để đổi số kho gõ (theo `line.dvt`) sang số tra lô/gợi ý phân bổ. */
  heSoVeGoc: number;
  cap: number;
  lots: LotPick[];
  thieu: number;
  donGia: string;
  /** Lý do cấp/nhập THIẾU (khi SL < còn phải cấp) — bắt buộc; hiện ở "Kho phản hồi" yêu cầu. */
  lyDo: string;
  /** Ghi chú riêng cho mặt hàng (dòng) trên phiếu. */
  ghiChu: string;
  /** Phiếu NHẬP: vị trí cất lô (kệ/ô) — tuỳ chọn; ghi sổ chép sang lô. */
  viTri: string;
  /** Phiếu NHẬP: HẠN SỬ DỤNG của đợt nhập này (tuỳ chọn, ISO). Một đợt = 1 lô = 1 hạn; nhiều hạn
   *  của cùng vật tư là do NHIỀU đợt nhập, tồn/báo cáo tự gom. */
  hsd: string;
  /** Phiếu NHẬP giấy: khổ của lô sắp tạo — mặc định chép từ dòng đề nghị, kho sửa được. Đơn vị gốc
   *  theo ĐVT dòng đề nghị (máy chủ suy), kho không chọn. */
  khoRong: number;
  khoDai: number;
  /** Phiếu NHẬP: đơn vị đang gõ ở ô SL nhập — "ton" (đơn vị tồn) hoặc "phu" (đơn vị quy đổi). */
  unit: "ton" | "phu";
  touched: boolean;
  warn: string | null;
  /** Lô vừa bị chặn trần — để tô viền rust ĐÚNG ô đang sai, không tô cả khối. */
  warnLotId: number | null;
}

/** Bộ lọc lô của một dòng yêu cầu: đơn vị gốc (`don_vi_goc`, máy chủ suy từ ĐVT dòng) + khổ (giấy).
 *  Vật tư khác chỉ lọc đơn vị gốc (kg và thùng không lấy lẫn). Hàng khác ⇒ rỗng. */
function locGiayDong(l: StockRequestLine): { goc?: string | null; kho_rong?: number; kho_dai?: number } {
  if (!coDonViGoc(l.hang_loai)) return {};
  if (l.hang_loai !== "giay") return { goc: l.don_vi_goc || null };
  return { goc: l.don_vi_goc || null, kho_rong: l.kho_rong, kho_dai: l.kho_dai };
}

function toLotPick(a: StockAllocationLine, catalog: StockLot[]): LotPick {
  const full = catalog.find((x) => x.id === a.lot_id);
  return {
    lot_id: a.lot_id,
    ma_lo: a.ma_lo,
    voucher_ma: full?.voucher_ma ?? null,
    ngay_nhap: a.ngay_nhap,
    hsd: a.hsd,
    vi_tri: full?.vi_tri ?? null,
    sl_con_lai: a.sl_con_lai,
    so_luong: a.so_luong,
    don_vi_goc: a.don_vi_goc ?? full?.don_vi_goc ?? "",
    kho_rong: a.kho_rong ?? full?.kho_rong ?? 0,
    kho_dai: a.kho_dai ?? full?.kho_dai ?? 0,
    don_gia_nhap: a.don_gia_nhap,
    order_ma: a.order_ma ?? null,
    khach_hang: a.khach_hang ?? null,
    canh_bao: a.canh_bao ?? null,
    chua_gia_goc: !!a.chua_gia_goc,
  };
}

/** XUẤT: rót `canGoc` (ĐƠN VỊ GỐC) vào các lô theo đúng thứ tự máy đã gợi ý (hết hạn trước) cho tới
 *  đủ số hoặc hết lô. Dùng cho "Cấp tối đa theo tồn" và khi kho gõ thẳng tổng ở ô Cấp lần này. */
function rotLo(b: AllocBlock, canGoc: number): AllocBlock {
  let con = canGoc;
  const lots = b.lots.map((x) => {
    const lay = Math.max(0, Math.min(x.sl_con_lai, con));
    con -= lay;
    return { ...x, so_luong: lay };
  });
  return { ...b, touched: true, warn: null, warnLotId: null, lots };
}

/** Dòng XUẤT cần kho để mắt: cấp chưa đủ (kho thiếu hoặc kho tự giảm), vừa bị chặn trần, hoặc đang
 *  lấy lô có cảnh báo. Dòng này tự bung bảng lô và nằm lên đầu; nút "Cần xem" lọc riêng chúng. */
function canXemDong(b: AllocBlock): boolean {
  if (b.line.sl_con_lai <= 0) return false;
  const lay = b.lots.reduce((s, x) => s + x.so_luong, 0) / (b.heSoVeGoc || 1);
  return lay < b.line.sl_con_lai - 1e-9 || !!b.warn || b.lots.some((x) => x.so_luong > 0 && !!x.canh_bao);
}

function VoucherCreateDrawer({
  token,
  request,
  khoList,
  initialKhoId,
  onClose,
  onSaved,
  tang,
}: {
  token: string;
  request: StockRequest;
  khoList: KhoOption[];
  initialKhoId: number;
  onClose: () => void;
  onSaved: () => void;
  /** Lớp chồng (0 = ngăn thường). */
  tang?: number;
}) {
  useNapTenDonVi();
  const isNhap = request.loai === "NHAP";
  // NGƯỜI LẬP PHIẾU LUÔN NHẬP + THẤY ĐƠN GIÁ (bỏ gate "xem giá vốn" ở bước lập) — theo yêu cầu:
  // ai tạo phiếu đều set giá; giá do người lập điền, không chờ Kế toán bổ sung nữa.
  const canViewCost = true;
  // Kho do BƯỚC LẬP PHIẾU quyết định (yêu cầu không còn chọn kho). Mặc định = kho đang xem ở
  // toolbar; thủ kho đổi được ngay tại đây. Đổi kho = nạp lại toàn bộ lô (dep của effect dưới).
  // Đề nghị có thành phẩm ⇒ kho BẮT BUỘC là Kho thành phẩm (máy chủ chặn kho khác) — ô kho khoá.
  const khoBatBuoc = request.kho_bat_buoc_id ?? null;
  const [khoId, setKhoId] = useState<number>(khoBatBuoc ?? request.kho_id ?? initialKhoId);
  // NGÀY NHẬP/XUẤT KHO = HÔM NAY, KHÓA CỨNG (không cho chọn). Đây là NGÀY HẠCH TOÁN — mốc
  // quyết định phiếu thuộc kỳ nào (khóa sổ + Sổ kho + N-X-T), nên không để người lập tự đặt.
  const [ngay] = useState(todayISO());
  // Người giao/nhận hàng = NGƯỜI YÊU CẦU, khoá cứng — server tự chốt từ tài khoản người tạo yêu cầu.
  const nguoiGiaoNhan = request.nguoi_tao_ten ?? "";
  // ĐIỀU CHUYỂN: ghi chú phiếu nhập đích LẤY SẴN từ ghi chú điều chuyển (đã gắn vào yêu cầu); sửa được.
  const [ghiChu, setGhiChu] = useState(request.dieu_chuyen ? (request.ghi_chu ?? "") : "");
  // Chứng từ (ảnh/PDF) chọn SẴN lúc tạo — giữ client-side, upload sau khi có voucher_id.
  const [files, setFiles] = useState<File[]>([]);
  const [blocks, setBlocks] = useState<AllocBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [askPost, setAskPost] = useState(false);
  // XUẤT nhiều mặt hàng: lọc "Cần xem" + tìm theo tên/mã. `uuTien` = dòng cần xem LÚC NẠP lô — chốt
  // thứ tự một lần để dòng không nhảy chỗ khi kho đang gõ số.
  const [locCanXem, setLocCanXem] = useState(false);
  const [timVt, setTimVt] = useState("");
  const [uuTien, setUuTien] = useState<Set<number>>(() => new Set());
  // Gợi ý VỊ TRÍ cất (kệ/ô) đã khai của kho ĐÍCH — chỉ phiếu NHẬP mới ghi vị trí lô. Chỉ để GỢI Ý
  // (datalist), thủ kho vẫn gõ tự do được nếu vị trí chưa khai trong danh mục.
  const [viTriOptions, setViTriOptions] = useState<string[]>([]);
  useEffect(() => {
    if (!isNhap || khoId == null) { setViTriOptions([]); return; }
    let alive = true;
    api.kho.viTri.list(token, khoId)
      .then((r) => { if (alive) setViTriOptions(r.items.map((v) => v.ma)); })
      .catch(() => { if (alive) setViTriOptions([]); });
    return () => { alive = false; };
  }, [token, khoId, isNhap]);

  // Tự chọn "Kho (xuất từ)" = kho có NHIỀU hàng nhất (ưu tiên mặt hàng đầu tiên) NGAY khi mở phiếu
  // XUẤT — thay vì bê kho đang xem ở toolbar (dễ trỏ vào kho rỗng). Chỉ chạy MỘT LẦN, cho MỌI phiếu
  // XUẤT thường; chỉ chừa ĐIỀU CHUYỂN (kho nguồn đã bị khoá). Sau đó thủ kho đổi tay tùy ý.
  // KHÔNG dùng cờ `cancelled`: StrictMode (dev) chạy effect 2 lần — cleanup lần 1 sẽ set cancelled
  // = true trong khi ref đã chặn lần 2 fetch → kết quả bị VỨT. Ref one-shot đủ đảm bảo gọi 1 lần;
  // setKhoId idempotent, có unmount sớm cũng chỉ là no-op (React 18 không cảnh báo).
  const daGoiYKho = useRef(false);
  useEffect(() => {
    if (daGoiYKho.current || isNhap || request.dieu_chuyen || khoBatBuoc != null) return;
    daGoiYKho.current = true;
    api.kho.deNghi
      .goiYKho(token, request.id)
      .then((r) => {
        if (r.kho_id == null || !khoList.some((w) => w.id === r.kho_id)) return;
        setKhoId(r.kho_id);
      })
      .catch(() => {});
  }, [token, request, isNhap, khoList, khoBatBuoc]);

  // Gợi ý lô chạy NGAY khi mở drawer, không chờ bấm nút: thủ kho mở phiếu ra là để lấy hàng,
  // bắt bấm thêm một nút "gợi ý" chỉ để có đúng cái FEFO mặc định là thao tác thừa.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const base: AllocBlock[] = request.lines.map((l) => ({
      line: l,
      matLabel: l.hang_ten ?? "—",
      matCode: l.hang_ma,
      anh: l.hang_anh,
      anhFile: null,
      anhRemove: false,
      // Server đã quy sẵn cho SL yêu cầu — suy ngược ra hệ số, khỏi gọi thêm API.
      heSoVeGoc: l.sl_quy_doi && l.sl_de_nghi ? l.sl_quy_doi / l.sl_de_nghi : 1,
      cap: l.sl_con_lai,
      lots: [],
      thieu: 0,
      // Đơn giá NHẬP LẤY TỪ YÊU CẦU (người yêu cầu khai) — kho chỉ đọc, không sửa.
      donGia: l.don_gia != null ? String(l.don_gia) : "",
      lyDo: "",
      ghiChu: "",
      viTri: "",
      hsd: "",
      khoRong: l.kho_rong,
      khoDai: l.kho_dai,
      unit: "ton",
      touched: false,
      warn: null,
      warnLotId: null,
    }));
    if (isNhap) {
      setBlocks(base);
      setLoading(false);
      return;
    }
    // XUẤT: tra lô theo ĐƠN VỊ GỐC — lô lưu theo đơn vị đó, gửi số theo đơn vị yêu cầu là lệch
    // đúng bằng hệ số quy đổi (xin 10 ram mà đi tìm 10 kg).
    const targets = request.lines.filter((l) => l.sl_con_lai > 0);
    Promise.all(
      targets.map(async (l) => {
        const hs = l.sl_quy_doi && l.sl_de_nghi ? l.sl_quy_doi / l.sl_de_nghi : 1;
        const mid = `${l.hang_loai}:${l.hang_id}`;
        const [lots, alloc] = await Promise.all([
          api.kho.phieu
            .danhSachLo(token, {
              hang_loai: l.hang_loai, hang_id: l.hang_id, kho_id: khoId, con_hang: true,
              // Giấy: chỉ lô đúng khổ + đơn vị gốc dòng xin (tờ và kg không lấy lẫn).
              ...locGiayDong(l),
              man: "yeu_cau",
            })
            .catch(() => [] as StockLot[]),
          api.kho.phieu
            .goiYLo(token, {
              hang_loai: l.hang_loai, hang_id: l.hang_id, kho_id: khoId,
              so_luong: l.sl_con_lai * hs,
              ...locGiayDong(l),
              // Xuất cho Giao hàng: máy chủ ưu tiên lô của đúng đơn, bỏ lô của khách khác.
              request_id: request.id,
            })
            .catch(() => null),
        ]);
        return { l, mid, lots, alloc };
      }),
    )
      .then((results) => {
        if (cancelled) return;
        for (const r of results) {
          const b = base.find((x) => x.line.id === r.l.id);
          if (b && r.alloc) {
            // Tự lấy lô theo FIFO/FEFO (goiYLo) — chỉ đọc, người dùng không chọn/sửa lô.
            b.lots = r.alloc.lines.map((a) => toLotPick(a, r.lots));
            b.thieu = r.alloc.thieu;
          }
        }
        setBlocks(base);
        setUuTien(new Set(base.filter(canXemDong).map((b) => b.line.id)));
      })
      .catch(() => {
        if (!cancelled) setBlocks(base);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // Đổi kho = đổi toàn bộ lô → nạp lại; đó là lý do kho bị khoá sau khi đã chọn lô đầu tiên.
  }, [token, request, khoId, isNhap]);

  function patch(lineId: number, fn: (b: AllocBlock) => AllocBlock) {
    setDirty(true);
    setBlocks((prev) => prev.map((b) => (b.line.id === lineId ? fn(b) : b)));
  }

  // XUẤT tự lấy lô theo FIFO/FEFO (goiYLo) làm MẶC ĐỊNH khi mở, nhưng kho SỬA được "SL lấy" từng lô
  // nếu cần (cap theo tồn của lô + số được duyệt). Không có "+ Thêm lô"/"✕" — chỉ sửa số là đủ.
  function setLotQty(lineId: number, lotId: number, raw: number) {
    patch(lineId, (b) => {
      const others = b.lots
        .filter((x) => x.lot_id !== lotId)
        .reduce((s, x) => s + x.so_luong, 0);
      const lot = b.lots.find((x) => x.lot_id === lotId);
      if (!lot) return b;
      const value = Number.isFinite(raw) ? Math.max(0, raw) : 0;
      let warn: string | null = null;
      let next = value;
      if (next > lot.sl_con_lai) {
        next = lot.sl_con_lai;
        warn = `Lô này chỉ còn ${fmtQty(lot.sl_con_lai)}.`;
      }
      // Mốc duyệt `sl_con_lai` theo ĐƠN VỊ YÊU CẦU, còn số lô (`others`/`next`) theo ĐƠN VỊ GỐC —
      // phải quy mốc về gốc rồi mới so, không thì vật tư có quy đổi (vd xin ram, lô lưu tờ) bị ép
      // "SL lấy" về 0 khi sửa tay (others gốc đã vượt sl_con_lai yêu cầu).
      const capGoc = b.line.sl_con_lai * (b.heSoVeGoc || 1);
      if (others + next > capGoc) {
        next = Math.max(0, capGoc - others);
        warn = `Chỉ được cấp ${fmtQty(capGoc)} theo duyệt — muốn cấp thêm phải tạo yêu cầu mới.`;
      }
      return {
        ...b,
        touched: true,
        warn,
        warnLotId: warn ? lotId : null,
        lots: b.lots.map((x) => (x.lot_id === lotId ? { ...x, so_luong: next } : x)),
      };
    });
  }

  // GỠ 2026-08-08: `resolvePick` + `resetToNew` — kho gắn/tạo mã cho hàng gõ tay. Mặt hàng nay
  // kế thừa từ dòng yêu cầu và đã có sẵn trong danh mục gốc, không còn gì để gắn.

  const payload = useMemo<StockVoucherLineInput[]>(() => {
    const out: StockVoucherLineInput[] = [];
    for (const b of blocks) {
      if (b.line.sl_con_lai <= 0) continue;
      const ghi = b.ghiChu.trim() || null;
      const ly = b.lyDo.trim() || null; // lý do cấp thiếu (backend bắt buộc khi SL < còn phải cấp)
      if (isNhap) {
        if (b.cap <= 0) continue;
        // SL + đơn giá gửi theo ĐƠN VỊ CỦA DÒNG YÊU CẦU; server tự quy về đơn vị gốc và chốt hệ
        // số vào `sl_goc`. FE KHÔNG tự nhân hệ số nữa — hai nơi cùng quy đổi là hai nơi lệch nhau.
        // Một đợt nhập = MỘT lô = MỘT hạn (tuỳ chọn). Không hạn → lô không hạn.
        out.push({
          request_line_id: b.line.id,
          so_luong: b.cap,
          don_gia: canViewCost ? Math.round(Number(b.donGia) || 0) : undefined,
          vi_tri: b.viTri.trim() || undefined,
          hsd: b.hsd || undefined,
          ...(b.line.hang_loai === "giay" && b.khoRong
            ? {
                kho_rong: chuanKho(b.khoRong, b.khoDai)[0],
                kho_dai: chuanKho(b.khoRong, b.khoDai)[1],
              }
            : {}),
          ly_do: ly,
          ghi_chu: ghi,
        });
      } else {
        // XUẤT: tách theo lô. `lot.so_luong` ở ĐƠN VỊ GỐC (lô lưu theo đơn vị đó) → đổi ngược về
        // đơn vị dòng yêu cầu trước khi gửi, vì server so `so_luong` với `sl_duyet`.
        let first = true;
        for (const lot of b.lots) {
          if (lot.so_luong > 0) {
            out.push({
              request_line_id: b.line.id,
              so_luong: b.heSoVeGoc > 0 ? lot.so_luong / b.heSoVeGoc : lot.so_luong,
              lot_id: lot.lot_id,
              ly_do: first ? ly : null,
              ghi_chu: first ? ghi : null,
            });
            first = false;
          }
        }
      }
    }
    return out;
  }, [blocks, isNhap, canViewCost]);

  const giaVon = useMemo(() => {
    if (!canViewCost) return 0;
    let sum = 0;
    for (const b of blocks) {
      if (b.line.sl_con_lai <= 0) continue;
      if (isNhap) sum += (Number(b.donGia) || 0) * b.cap;
      else for (const lot of b.lots) sum += (lot.don_gia_nhap ?? 0) * lot.so_luong;
    }
    return Math.round(sum);
  }, [blocks, isNhap, canViewCost]);
  // Còn dòng thành phẩm KCS chưa có giá gốc ⇒ tổng "0 đ" là sai nghĩa, báo thẳng thay vì in số.
  // XUẤT: lấy từ lô KCS chưa có giá gốc ⇒ tổng chỉ là phần đã biết giá (12/10/2026).
  const thieuGiaGoc = isNhap
    ? blocks.some((b) => b.line.tu_kcs && b.line.sl_con_lai > 0 && !(Number(b.donGia) > 0))
    : blocks.some((b) => b.line.sl_con_lai > 0 && b.lots.some((x) => x.chua_gia_goc && x.so_luong > 0));
  // Cột Giá bán riêng — server chỉ trả giá bán cho người có `view_cost` nên không cần gate thêm.
  const hienGiaBan = isNhap && blocks.some((b) => b.line.don_gia_ban != null);

  // Kiểm tra hợp lệ dùng CHUNG cho nút "Tạo & Ghi sổ" (báo NGAY khi bấm, không để lọt vào popup
  // rồi mới báo) và cho submit (chốt chặn). Trả câu lỗi ĐẦU TIÊN, null nếu hợp lệ.
  function firstError(): string | null {
    if (!payload.length)
      return "Chưa có dòng nào để cấp. Nhập số lượng hoặc chọn lô trước khi lưu.";
    for (const b of blocks) {
      if (b.line.sl_con_lai <= 0) continue;
      // Cả hai vế quy về ĐƠN VỊ DÒNG YÊU CẦU để so với `sl_con_lai` — lô đếm theo đơn vị gốc.
      const capped = isNhap
        ? b.cap
        : b.lots.reduce((s, x) => s + x.so_luong, 0) / (b.heSoVeGoc || 1);
      if (capped > b.line.sl_con_lai + 1e-9)
        return "Ứng vượt số đã duyệt. Muốn cấp thêm thì phải tạo yêu cầu mới.";
      // Cấp/nhập ÍT HƠN còn phải cấp → bắt buộc LÝ DO (kho phản hồi).
      if (capped > 0 && capped < b.line.sl_con_lai - 1e-9 && !b.lyDo.trim())
        return isNhap
          ? `"${b.matLabel}" nhập ít hơn số còn phải nhập. Ghi lý do, ví dụ nhà cung cấp giao thiếu.`
          : `"${b.matLabel}" cấp ít hơn số còn phải cấp. Ghi lý do, ví dụ kho không đủ tồn.`;
    }
    return null;
  }

  async function submit(post: boolean) {
    const err = firstError();
    if (err) {
      setError(err);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const v = await api.kho.phieu.create(token, {
        request_id: request.id,
        kho_id: khoId,
        // Số phiếu LUÔN tự sinh (PNK/PXK####) — không cho tự nhập.
        ngay,
        ghi_chu: ghiChu || null,
        lines: payload,
        ghi_so: post,
      });
      // Chứng từ đã chọn cần voucher_id → upload NGAY SAU khi tạo phiếu (trước khi ghi sổ).
      for (const f of files) {
        await api.kho.phieu.uploadAttachment(token, v.id, f);
      }
      // Ảnh mặt hàng (cả nhập lẫn xuất): CHỈ lưu vào danh mục khi ĐÃ tạo phiếu (thêm ảnh rồi thoát
      // giữa chừng thì không lưu). Best-effort — ảnh minh hoạ lỗi KHÔNG chặn/roll back việc tạo phiếu.
      for (const b of blocks) {
        try {
          if (b.anhFile)
            await api.matHang.uploadAnh(token, b.line.hang_loai, b.line.hang_id, b.anhFile);
          else if (b.anhRemove)
            await api.matHang.xoaAnh(token, b.line.hang_loai, b.line.hang_id);
        } catch {
          /* ảnh minh hoạ lỗi — bỏ qua, không chặn tạo phiếu */
        }
      }
      if (post) await api.kho.phieu.ghiSo(token, v.id);
      setDirty(false);
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Không lưu được phiếu.");
    } finally {
      setBusy(false);
    }
  }

  // "Cấp tối đa theo tồn" (XUẤT): rót lại từng lô theo đúng thứ tự máy đã gợi ý (hết hạn trước) cho
  // tới đủ số còn phải cấp hoặc hết lô. "Nhập đủ theo yêu cầu" (NHẬP): mọi dòng về đúng số còn lại.
  function lamDay() {
    setDirty(true);
    setBlocks((prev) =>
      prev.map((b) => {
        if (b.line.sl_con_lai <= 0) return b;
        if (isNhap) return { ...b, touched: true, cap: b.line.sl_con_lai };
        return rotLo(b, b.line.sl_con_lai * (b.heSoVeGoc || 1));
      }),
    );
  }

  // XUẤT: kho gõ thẳng tổng ở ô "Cấp lần này" (đơn vị yêu cầu) — máy chia lại vào lô, không quá số duyệt.
  function capXuat(lineId: number, v: number) {
    patch(lineId, (b) => rotLo(b, Math.max(0, Math.min(v, b.line.sl_con_lai)) * (b.heSoVeGoc || 1)));
  }

  const dongCan = blocks.filter((b) => b.line.sl_con_lai > 0);
  const soDuLanNay = dongCan.filter((b) => {
    const lay = isNhap ? b.cap : b.lots.reduce((s, x) => s + x.so_luong, 0) / (b.heSoVeGoc || 1);
    return lay >= b.line.sl_con_lai - 1e-9;
  }).length;
  // NHẬP: Vị trí + Hạn dùng (+ Khổ khi có dòng giấy) là cột của lưới, mỗi mặt hàng MỘT dòng.
  const coGiay = isNhap && blocks.some((b) => b.line.hang_loai === "giay" && b.line.sl_con_lai > 0);
  const soCot = (isNhap ? 8 + (coGiay ? 1 : 0) : 7) + (hienGiaBan ? 1 : 0);
  const soCanXem = isNhap ? 0 : blocks.filter(canXemDong).length;
  const dongHien = isNhap
    ? blocks
    : blocks
        .filter((b) => (!locCanXem || canXemDong(b)) && khopGanDung(`${b.matLabel} ${b.matCode ?? ""}`, timVt))
        .sort((a, b) => Number(uuTien.has(b.line.id)) - Number(uuTien.has(a.line.id)));

  function bamGhiSo() {
    // Báo NGAY khi bấm (ứng vượt / cấp thiếu chưa nêu lý do) — không mở popup rồi mới báo.
    const err = firstError();
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setAskPost(true);
  }

  return (
    <>
      <NganPhai
        tang={tang}
        duongDan={<span>{request.dieu_chuyen ? "Lập phiếu điều chuyển" : isNhap ? "Lập phiếu nhập kho" : "Lập phiếu xuất kho"}</span>}
        tieuDe={`Theo ${request.ma}`}
        the={<RequestStatusBadge status={request.trang_thai} loai={request.loai} />}
        chanDong={() => dirty}
        onDong={onClose}
      >
        <div className="kna">
          {error && (
            <div className="banner banner--error" role="alert">
              <span>{error}</span>
            </div>
          )}
          {request.dieu_chuyen && isNhap && (
            // Phiếu NHẬP đích của một điều chuyển: đơn giá đã KHOÁ theo giá vốn chốt ở kho nguồn
            // (không gõ tay). Nêu rõ để người lập không thắc mắc vì sao đơn giá không sửa được.
            <div className="kna-canh kna-canh--xanh">
              <span>
                Phiếu điều chuyển{request.kho_nguon_ten ? ` từ kho ${request.kho_nguon_ten}` : ""}. Đơn giá khoá
                theo giá vốn nguồn. <b>Ghi sổ phiếu này sẽ trừ kho nguồn và cộng kho đích cùng lúc.</b>
              </span>
            </div>
          )}
          <div className="kna-luoi">
            <div className="kna-cot">
              <TheA cat tieuDe={isNhap ? "Vật tư nhập" : "Vật tư cấp"}
                phai={!loading && dongCan.length > 0 ? (
                  <>
                    {!isNhap && (
                      <span className="kna-loc" role="group" aria-label="Lọc vật tư cấp">
                        <button type="button" className={locCanXem ? undefined : "on"} aria-pressed={!locCanXem}
                          onClick={() => setLocCanXem(false)}>
                          Tất cả<span>{blocks.length}</span>
                        </button>
                        <button type="button" className={locCanXem ? "on" : undefined} aria-pressed={locCanXem}
                          onClick={() => setLocCanXem(true)}>
                          Cần xem<span>{soCanXem}</span>
                        </button>
                      </span>
                    )}
                    {!isNhap && (
                      <input className="kna-o kna-o--nho kna-tim" value={timVt} placeholder="Tìm vật tư"
                        aria-label="Tìm vật tư trong phiếu" onChange={(e) => setTimVt(e.target.value)} />
                    )}
                    <button type="button" className="kna-lien" onClick={lamDay}>
                      {isNhap ? "Nhập đủ theo yêu cầu" : "Cấp tối đa theo tồn"}
                    </button>
                  </>
                ) : undefined}>
                {loading ? (
                  <div className="kna-the__than" style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
                    {Array.from({ length: 3 }).map((_, i) => (
                      <span key={i} className="rc-skel" style={{ width: "100%", height: 56 }} />
                    ))}
                  </div>
                ) : (
                  <div className="lds-bang lds-bang--nhap kna-cuon">
                    {/* Gợi ý vị trí cất (kệ/ô) đã khai của kho — 1 datalist dùng chung cho mọi ô Vị trí. */}
                    {isNhap && viTriOptions.length > 0 && (
                      <datalist id="kho-vitri-suggest">
                        {viTriOptions.map((v) => <option key={v} value={v} />)}
                      </datalist>
                    )}
                    {/* Cột cố định cộng lại + 200 cho cột Vật tư (tên, mã, ảnh, khổ giấy): đủ rộng thì vừa khung, chật hơn
                        (đủ cột Đơn giá + Giá bán ở cột chính ~760px) thì khung tự cuộn ngang thay vì bóp cột Vật tư. */}
                    <table className={`lds-g ${isNhap ? "kna-luoi-nhap" : "kna-luoi-xuat"}`} style={{
                      minWidth: isNhap
                        ? 176 + 76 + 64 + 88 + 96 + 132 + (coGiay ? 220 : 0) + 76 + 84 + (hienGiaBan ? 84 : 0)
                        : 32 + 200 + 84 + 84 + 104 + 188 + 96 + (hienGiaBan ? 84 : 0),
                    }}>
                      <colgroup>
                        {!isNhap && <col style={{ width: 32 }} />}
                        <col />
                        <col style={{ width: isNhap ? 76 : 84 }} />
                        <col style={{ width: isNhap ? 64 : 84 }} />
                        <col style={{ width: isNhap ? 88 : 104 }} />
                        {!isNhap && <col style={{ width: 188 }} />}
                        {isNhap && <col style={{ width: 96 }} />}
                        {isNhap && <col style={{ width: 132 }} />}
                        {coGiay && <col style={{ width: 220 }} />}
                        {isNhap && <col style={{ width: 76 }} />}
                        <col style={{ width: isNhap ? 84 : 96 }} />
                        {hienGiaBan && <col style={{ width: 84 }} />}
                      </colgroup>
                      <thead>
                        <tr>
                          {!isNhap && <th aria-label="Mở bảng lô" />}
                          <th>Vật tư</th>
                          <th className="n">Yêu cầu</th>
                          <th className="n">{isNhap ? "Tồn" : "Tồn kho"}</th>
                          <th className="n">{isNhap ? "Nhập" : "Cấp lần này"}</th>
                          {!isNhap && <th>Lấy từ</th>}
                          {isNhap && <th>Vị trí cất</th>}
                          {isNhap && <th>Hạn dùng</th>}
                          {coGiay && <th>Khổ thực nhận</th>}
                          {isNhap && <th className="n">{blocks.some((b) => b.line.tu_kcs) ? "Giá gốc" : "Đơn giá"}</th>}
                          {/* XUẤT: giá vốn đích danh theo lô — chữ "Thành tiền" bị đọc nhầm là tiền bán. */}
                          <th className="n">{isNhap ? "Thành tiền" : "Giá vốn"}</th>
                          {hienGiaBan && <th className="n">Giá bán</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {dongHien.length === 0 && (
                          <tr>
                            <td colSpan={soCot} className="lds-trong">
                              {timVt.trim() ? "Không có vật tư nào khớp." : "Không còn vật tư nào cần xem."}
                            </td>
                          </tr>
                        )}
                        {dongHien.map((b) => (
                          <AllocRow
                            key={b.line.id}
                            token={token}
                            khoId={khoId}
                            block={b}
                            isNhap={isNhap}
                            canViewCost={canViewCost}
                            hienGiaBan={hienGiaBan}
                            soCot={soCot}
                            coGiay={coGiay}
                            viTriListId={isNhap && viTriOptions.length > 0 ? "kho-vitri-suggest" : undefined}
                            onCap={(v) =>
                              isNhap ? patch(b.line.id, (cur) => ({ ...cur, touched: true, cap: v })) : capXuat(b.line.id, v)
                            }
                            onLyDo={(v) => patch(b.line.id, (cur) => ({ ...cur, lyDo: v }))}
                            onLotQty={(lotId, v) => setLotQty(b.line.id, lotId, v)}
                            onViTri={(v) => patch(b.line.id, (cur) => ({ ...cur, touched: true, viTri: v }))}
                            onHsd={(v) => patch(b.line.id, (cur) => ({ ...cur, touched: true, hsd: v }))}
                            onKho={(p) => patch(b.line.id, (cur) => ({ ...cur, touched: true, ...p }))}
                            onAnhPick={(file) =>
                              patch(b.line.id, (cur) => ({ ...cur, anhFile: file, anhRemove: false }))
                            }
                            onAnhClear={() =>
                              patch(b.line.id, (cur) =>
                                cur.anhFile ? { ...cur, anhFile: null } : { ...cur, anhRemove: true },
                              )
                            }
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </TheA>

              {/* Đính kèm chứng từ NGAY khi tạo: chọn file giữ client-side, upload sau khi có voucher_id. */}
              <TheA tieuDe="Chứng từ gốc">
                <div className="kna-the__than">
                  {files.length > 0 && (
                    <ul className="kna-tep">
                      {files.map((f, i) => (
                        <li key={i}>
                          <FileText size={16} aria-hidden="true" />
                          <span>{f.name}</span>
                          <button type="button" aria-label={`Bỏ ${f.name}`}
                            onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}>
                            <Icon name="x" size={14} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <label className="kna-tha">
                    <b>Thêm ảnh hoặc PDF</b> {isNhap ? "hoá đơn, phiếu giao của nhà cung cấp." : "chứng từ kèm phiếu."} Không bắt buộc.
                    <input
                      type="file"
                      accept="image/*,application/pdf"
                      multiple
                      hidden
                      onChange={(e) => {
                        const picked = Array.from(e.target.files ?? []);
                        if (picked.length) {
                          setDirty(true);
                          setFiles((prev) => [...prev, ...picked]);
                        }
                        e.target.value = "";
                      }}
                    />
                  </label>
                </div>
              </TheA>
            </div>

            <div className="kna-cot">
              <TheA tieuDe="Phiếu">
                <div className="kna-the__than kna-form">
                  {request.dieu_chuyen ? (
                    <KvA dong={[
                      ["Từ kho", request.kho_nguon_ten || "—"],
                      ["Đến kho", request.kho_ten || khoList.find((w) => w.id === khoId)?.ten || "—"],
                    ]} />
                  ) : khoBatBuoc != null ? (
                    <label className="kna-o-truong">
                      <span>{isNhap ? "Nhập về kho" : "Xuất từ kho"}</span>
                      <input className="kna-o kna-o--khoa" readOnly
                        value={request.kho_ten || khoList.find((w) => w.id === khoBatBuoc)?.ten || "Kho thành phẩm"}
                        title="Thành phẩm chỉ nhập, xuất ở Kho thành phẩm." />
                    </label>
                  ) : (
                    <div className="kna-o-truong">
                      <span>{isNhap ? "Nhập về kho" : "Xuất từ kho"} <em>*</em></span>
                      <Select
                        portal
                        options={khoList.map((w) => ({ value: w.id, label: w.ten, hint: w.ma }))}
                        value={khoId}
                        onChange={(v) => {
                          if (v == null) return;
                          setDirty(true);
                          setKhoId(Number(v));
                        }}
                        ariaLabel="Kho của phiếu"
                        placeholder="Chọn kho"
                      />
                      {!isNhap && <div className="kna-o-truong__goi">Gợi ý theo kho đang có nhiều hàng nhất</div>}
                    </div>
                  )}
                  {/* NGÀY NHẬP/XUẤT = HÔM NAY, khoá cứng: đây là ngày hạch toán quyết định kỳ khoá sổ. */}
                  <label className="kna-o-truong">
                    <span>{isNhap ? "Ngày nhập" : "Ngày xuất"}</span>
                    <input className="kna-o kna-o--khoa" value={`${fmtDateISO(ngay)} (hôm nay)`} readOnly
                      title="Ngày nhập xuất kho luôn là hôm nay. Đây là mốc khoá sổ nên không sửa được." />
                  </label>
                  <label className="kna-o-truong">
                    <span>{isNhap ? "Người giao hàng" : "Người nhận hàng"}</span>
                    <input className="kna-o kna-o--khoa" value={nguoiGiaoNhan} readOnly
                      title="Luôn là người yêu cầu, lấy theo tài khoản nên không sửa được." />
                  </label>
                  <label className="kna-o-truong">
                    <span>Ghi chú</span>
                    <input className="kna-o" value={ghiChu} placeholder="Không bắt buộc"
                      onChange={(e) => {
                        setDirty(true);
                        setGhiChu(e.target.value);
                      }} />
                  </label>
                </div>
              </TheA>
              <TheNguonHang r={request} />
              <TheGiaoHang r={request} />
              <TheA>
                <div className="kna-the__than" style={{ paddingTop: 16 }}>
                  <KvA dong={[
                    dongCan.length > 0 && [isNhap ? "Nhập đủ" : "Cấp đủ", `${soDuLanNay}/${dongCan.length} mặt hàng`],
                    canViewCost && [
                      isNhap ? "Tổng tiền nhập" : "Tổng giá vốn",
                      thieuGiaGoc && giaVon === 0 ? <span className="kna-lon">Chưa có giá gốc</span> : (
                        <span className="kna-tong-gv">
                          <span className="kna-lon kna-so">{money(giaVon)}</span>
                          {thieuGiaGoc && <span className="kna-dv">chưa gồm hàng chưa có giá gốc</span>}
                        </span>
                      ),
                    ],
                  ]} />
                  <div className="kna-chot">
                    <NutDongNgan />
                    {/* Create & post đã GỘP 1 quyền: lập phiếu = GHI SỔ NGAY. Xác nhận trước khi ghi vì
                        phiếu không sửa được nữa. */}
                    <button type="button" className="kna-nut kna-nut--chinh" disabled={busy || loading} onClick={bamGhiSo}>
                      {busy ? "Đang lưu…" : "Tạo và ghi sổ"}
                    </button>
                  </div>
                </div>
              </TheA>
            </div>
          </div>
        </div>
      </NganPhai>

      <ConfirmDialog
        open={askPost}
        title={isNhap ? "Ghi sổ phiếu nhập kho?" : "Ghi sổ phiếu xuất kho?"}
        message={
          isNhap
            ? "Tồn kho sẽ cộng ngay và phiếu không sửa được nữa."
            : "Tồn kho sẽ trừ ngay và phiếu không sửa được nữa."
        }
        confirmLabel="Ghi sổ"
        busy={busy}
        onCancel={() => setAskPost(false)}
        onConfirm={() => {
          setAskPost(false);
          void submit(true);
        }}
      />
    </>
  );
}

/** Nút "Đóng" trong thân ngăn — đi qua `useDongNgan` để còn hỏi "Bỏ phiếu đang nhập?". */
function NutDongNgan() {
  const dong = useDongNgan();
  return (
    <button type="button" className="kna-nut" onClick={dong}>
      Đóng
    </button>
  );
}

function AllocRow({
  token,
  khoId,
  block,
  isNhap,
  canViewCost,
  hienGiaBan,
  soCot,
  coGiay,
  viTriListId,
  onCap,
  onLyDo,
  onLotQty,
  onViTri,
  onHsd,
  onKho,
  onAnhPick,
  onAnhClear,
}: {
  token: string;
  khoId: number;
  block: AllocBlock;
  isNhap: boolean;
  canViewCost: boolean;
  /** Bảng có cột Giá bán (tham khảo) — cột riêng, KHÔNG gộp vào ô đơn giá (giá gốc). */
  hienGiaBan: boolean;
  /** Số cột của bảng — hàng phụ (lô / cất hàng / lý do) trải hết bề ngang. */
  soCot: number;
  /** Lưới NHẬP có cột "Khổ thực nhận" (có ít nhất một dòng giấy còn phải nhập). */
  coGiay: boolean;
  /** id của <datalist> gợi ý vị trí (kệ/ô) đã khai của kho; undefined = không gợi ý (vẫn gõ tự do). */
  viTriListId?: string;
  onCap: (v: number) => void;
  onLyDo: (v: string) => void;
  onLotQty: (lotId: number, v: number) => void;
  onViTri: (v: string) => void;
  onHsd: (v: string) => void;
  /** Phiếu NHẬP giấy: sửa khổ của lô sắp tạo. */
  onKho: (p: { khoRong?: number; khoDai?: number }) => void;
  /** Chọn/đổi ảnh mặt hàng — GIỮ file client-side, chỉ lưu khi LẬP PHIẾU. */
  onAnhPick: (file: File) => void;
  /** Bỏ ảnh: có file đang chờ thì huỷ chọn; không thì đánh dấu gỡ ảnh cũ (áp khi lập phiếu). */
  onAnhClear: () => void;
}) {
  const l = block.line;
  // Ảnh mặt hàng — GIỮ file ở CLIENT, chỉ lưu vào danh mục KHI LẬP PHIẾU: thêm ảnh rồi thoát mà chưa
  // lập thì KHÔNG lưu. `block.anhFile` = ảnh mới đang chờ; `block.anhRemove` = đánh dấu gỡ ảnh cũ.
  const [anhZoom, setAnhZoom] = useState(false);
  const preview = useMemo(
    () => (block.anhFile ? URL.createObjectURL(block.anhFile) : null),
    [block.anhFile],
  );
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  const shownAnh = preview ?? (!block.anhRemove && block.anh ? assetUrl(block.anh) : null);
  // Tồn hiện tại trong kho này (cả NHẬP lẫn XUẤT) — biết đang thêm/rút khỏi đâu.
  const [tonInfo, setTonInfo] = useState<{ ton: number; gia: number | null } | null>(null);
  useEffect(() => {
    let cancelled = false;
    api.kho.phieu
      .danhSachLo(token, {
        hang_loai: l.hang_loai, hang_id: l.hang_id, kho_id: khoId, con_hang: true,
        ...locGiayDong(l),
        man: "yeu_cau",
      })
      .then((lots) => {
        if (cancelled) return;
        const ton = lots.reduce((s, x) => s + x.sl_con_lai, 0);
        const gia = lots.length ? lots[lots.length - 1].don_gia_nhap ?? null : null;
        setTonInfo({ ton, gia });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [l.hang_loai, l.hang_id, l.don_vi_goc, l.kho_rong, l.kho_dai, khoId, token]);

  const chosen = block.lots.reduce((s, x) => s + x.so_luong, 0);   // tổng đã lấy — ĐƠN VỊ GỐC (lô)
  // Mốc cần (đơn vị yêu cầu) quy về GỐC để so cho khớp bảng lô.
  const targetGoc = l.sl_con_lai * (block.heSoVeGoc || 1);
  const matched = Math.abs(chosen - targetGoc) < 1e-6;
  // Cấp/nhập ÍT HƠN còn phải cấp → bắt buộc LÝ DO (kho phản hồi). Quy cả hai vế về ĐƠN VỊ DÒNG
  // YÊU CẦU (lô đếm theo đơn vị gốc) rồi mới so với `sl_con_lai`.
  const cappedTon = isNhap ? block.cap : chosen / (block.heSoVeGoc || 1);
  // Tồn THẬT của các lô (đơn vị yêu cầu) — câu "Kho chỉ còn…" nói số này, không nói số đang lấy.
  const tonCo = block.lots.reduce((s, x) => s + x.sl_con_lai, 0) / (block.heSoVeGoc || 1);
  const isShort = l.sl_con_lai > 0 && cappedTon > 0 && cappedTon < l.sl_con_lai - 1e-9;
  const settled = l.sl_con_lai <= 0;
  // XUẤT: bảng lô chỉ bung khi cần — dòng cần xem tự bung; kho bấm mũi tên để mở/đóng (bấm rồi thì giữ ý kho).
  const canXem = !isNhap && canXemDong(block);
  const [moLo, setMoLo] = useState<boolean | null>(null);
  const moThat = !isNhap && !settled && (moLo ?? canXem);
  const dangLay = block.lots.filter((x) => x.so_luong > 1e-9);
  // SL yêu cầu theo đơn vị NGƯỜI YÊU CẦU (`l.dvt`); tồn theo đơn vị GỐC lưu kho — hai đơn vị khác
  // nhau nên luôn kèm nhãn để khỏi lẫn (70 tờ vs 1 ram).
  const dvtYc = tenDv(l.dvt);
  const dvtGoc = tenDv(l.don_vi_goc ?? l.dvt);
  // Giá vốn dòng: XUẤT tính đích danh theo lô đã lấy; NHẬP theo đơn giá người yêu cầu khai.
  const nhapGia = Number(block.donGia || 0);
  const lotCost = block.lots.reduce((s, x) => s + x.so_luong * (x.don_gia_nhap ?? 0), 0);
  const thanhTien = isNhap ? block.cap * nhapGia : lotCost;
  // Thành phẩm KCS: dòng yêu cầu giữ 0 đ, giá gốc kế toán gõ SAU khi ghi sổ — nói thẳng, đừng in "0 đ".
  const kcsChuaGia = isNhap && l.tu_kcs && !(nhapGia > 0);
  // XUẤT: số lấy từ lô KCS chưa có giá gốc (đơn vị gốc) — giá vốn dòng chỉ là phần đã biết giá.
  const slChuaGia = isNhap ? 0 : block.lots.reduce((s, x) => s + (x.chua_gia_goc ? x.so_luong : 0), 0);

  // Con số THẬT SỰ vào tồn — nhập "10 ram" mà lô ghi 419,25 kg thì phải nói ra ngay đây.
  // Giấy tờ khai kg: tính lại theo số gõ + khổ thực nhận, làm tròn xuống như lúc ghi sổ — nhân hệ số
  // của số đề nghị (đã làm tròn) là ra tờ lẻ / lệch 1 tờ.
  const [rNhan, dNhan] = chuanKho(block.khoRong, block.khoDai);
  const toNhan = l.kg_moi_dvt != null && l.gsm != null
    ? toTuKg(block.cap * l.kg_moi_dvt, rNhan, dNhan, l.gsm) : undefined;
  const quyDoiHint =
    isNhap && block.heSoVeGoc !== 1 && block.cap > 0 && l.don_vi_goc && toNhan !== null ? (
      <div className="kna-phu__goi">
        {toNhan === undefined ? (
          <>
            Vào tồn {fmtQty(block.cap * block.heSoVeGoc)} {tenDv(l.don_vi_goc)}
            {l.quy_doi_dien_giai ? <> ({l.quy_doi_dien_giai})</> : null}
          </>
        ) : (
          <>Vào tồn {fmtQty(toNhan)} {tenDv(l.don_vi_goc)} (làm tròn xuống theo khổ thực nhận)</>
        )}
      </div>
    ) : null;
  // Cấp/nhập ÍT HƠN còn phải cấp → BẮT BUỘC nhập lý do; hiện ở ngăn yêu cầu.
  const lyDoBox = isShort ? (
    <label className="kna-o-truong">
      <span>
        Lý do {isNhap ? "nhập" : "cấp"} thiếu {fmtQty(l.sl_con_lai - cappedTon)} {dvtYc} <em>*</em>
      </span>
      <input
        className={`kna-o${!block.lyDo.trim() ? " kna-o--loi" : ""}`}
        value={block.lyDo}
        onChange={(e) => onLyDo(e.target.value)}
        placeholder={isNhap ? "Ví dụ: nhà cung cấp giao thiếu, hẹn bù đợt sau" : `Ví dụ: kho chỉ còn ${fmtQty(tonCo)} ${dvtYc}, chờ hàng về`}
      />
    </label>
  ) : null;

  const chonAnh = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) onAnhPick(f);
    e.target.value = "";
  };
  // Ô ảnh nhỏ đầu dòng: chưa có ảnh thì bấm để thêm (lưới khỏi chữ "Thêm ảnh"); có ảnh thì bấm phóng to,
  // đổi / xoá ảnh nằm trong khung phóng to.
  const anhNut = !shownAnh && !settled ? (
    <label className="kna-hang__anh kna-hang__anh--them" title="Thêm ảnh mặt hàng" aria-label={`Thêm ảnh ${block.matLabel}`}>
      <Package size={14} aria-hidden="true" />
      <input type="file" accept="image/*" hidden onChange={chonAnh} />
    </label>
  ) : (
    <button type="button" className="kna-hang__anh" onClick={() => (shownAnh ? setAnhZoom(true) : undefined)}
      title={shownAnh ? "Bấm để phóng to" : "Chưa có ảnh"} aria-label={shownAnh ? `Phóng to ảnh ${block.matLabel}` : "Chưa có ảnh"}>
      {shownAnh ? <img src={shownAnh} alt="" /> : <Package size={14} aria-hidden="true" />}
    </button>
  );
  const khoGiayO = (
    <div className="kna-kho-giay">
      <DecimalInput
        className="kna-o kna-o--nho kna-o--so"
        value={block.khoRong || null}
        onChange={(n) => onKho({ khoRong: n ?? 0 })}
        aria-label="Khổ giấy, cạnh rộng (mm)"
        placeholder="Rộng"
      />
      <span aria-hidden="true">×</span>
      {/* Để trống ô Dài = khổ chỉ rộng (giấy khổ rộng chưa cắt). */}
      <DecimalInput
        className="kna-o kna-o--nho kna-o--so"
        value={block.khoDai || null}
        onChange={(n) => onKho({ khoDai: n ?? 0 })}
        aria-label="Khổ giấy, cạnh dài (mm), để trống nếu chỉ có khổ rộng"
        placeholder="Dài"
      />
      <span className="kna-dv">mm</span>
    </div>
  );

  // Ghi chú ngắn dưới "Lấy từ": vì sao dòng này cần xem — thiếu hàng hay lô có cảnh báo.
  const loCanh = dangLay.find((x) => x.canh_bao);
  const thieuLanNay = l.sl_con_lai - cappedTon;
  const ghiXuat: { chu: string; sai: boolean } | null = isNhap || settled
    ? null
    : thieuLanNay > 1e-9
      ? cappedTon <= 1e-9
        ? { chu: tonCo <= 1e-9 ? "Hết hàng, chưa cấp lần này" : "Không cấp lần này", sai: false }
        : {
            chu: `${tonCo < l.sl_con_lai - 1e-9 ? "Kho thiếu" : "Cấp thiếu"} ${fmtQty(thieuLanNay)} ${dvtYc}${block.lyDo.trim() ? "" : ", chưa ghi lý do"}`,
            sai: !block.lyDo.trim(),
          }
      : loCanh
        ? { chu: loCanh.canh_bao ?? "", sai: false }
        : null;

  return (
    <>
      <tr>
        {!isNhap && (
          <td>
            {!settled && (
              <button type="button" className={`kna-mui${moThat ? " kna-mui--mo" : ""}`} aria-expanded={moThat}
                aria-label={`${moThat ? "Đóng" : "Mở"} bảng lô ${block.matLabel}`} title="Chọn lô"
                onClick={() => setMoLo(!moThat)}>
                <ChevronRight size={14} aria-hidden="true" />
              </button>
            )}
          </td>
        )}
        <td>
          <HangA ten={block.matLabel} anhNut={anhNut}
            phu={<>
              {block.matCode && <span className="kna-tag kna-tag--ma">{block.matCode}</span>}
              {!(isNhap && l.hang_loai === "giay") && nhanKhoGiay(l) && <span>{nhanKhoGiay(l)}</span>}
              {(l.lsx_ma || l.bai_ghep_ma) && <span>{l.lsx_ma ?? l.bai_ghep_ma}</span>}
            </>} />
        </td>
        <td className="n">
          <SoA so={l.sl_de_nghi} dv={dvtYc} />
          {/* Đã cấp ở phiếu trước — mốc của ô "lần này" là phần còn lại, không phải số xin. */}
          {l.sl_da_ung > 0 && !settled && (
            <div className="kna-hang__phu" style={{ justifyContent: "flex-end" }}>Đã {isNhap ? "nhập" : "cấp"} {fmtQty(l.sl_da_ung)}</div>
          )}
        </td>
        <td className="n">
          {/* Tồn thực tế trong kho này TRƯỚC khi phiếu ghi sổ, theo ĐƠN VỊ GỐC. */}
          {tonInfo ? (
            !isNhap && !settled && tonInfo.ton <= 1e-9 ? (
              <span className="kna-chip kna-chip--do">Hết tồn</span>
            ) : (
              <SoA so={tonInfo.ton} dv={dvtGoc !== dvtYc ? dvtGoc : null} />
            )
          ) : (
            <span className="kna-mo">…</span>
          )}
        </td>
        <td className="n">
          {settled ? (
            <span className="kna-chip kna-chip--la">{isNhap ? "Đã nhập đủ" : "Đã cấp đủ"}</span>
          ) : isNhap ? (
            // Dòng không muốn làm đợt này thì để 0 là tự bỏ qua — không cần ô tick riêng. Mốc tối đa
            // (còn phải nhập) đã ở cột Yêu cầu nên khỏi lặp "/ 1.500" bên cạnh ô.
            <DecimalInput
              id={`cap-${l.id}`}
              className={`kna-o kna-o--nho kna-o--so${isShort ? " kna-o--thieu" : ""}`}
              value={block.cap}
              onChange={(n) => onCap(n ?? 0)}
              aria-label={`Số lượng nhập ${block.matLabel}, còn phải nhập ${fmtQty(l.sl_con_lai)} ${dvtYc}`}
            />
          ) : (
            // XUẤT: ô = TỔNG ô "Lấy" ở bảng lô (quy về đơn vị dòng yêu cầu). Gõ thẳng tổng thì máy chia
            // lại vào lô theo hạn dùng; muốn chỉ định lô thì mở bảng lô.
            <DecimalInput
              id={`cap-${l.id}`}
              className={`kna-o kna-o--nho kna-o--so${thieuLanNay > 1e-9 ? " kna-o--thieu" : ""}`}
              value={Math.round(cappedTon * 1000) / 1000}
              onChange={(n) => onCap(n ?? 0)}
              aria-label={`Số lượng cấp ${block.matLabel}, còn phải cấp ${fmtQty(l.sl_con_lai)} ${dvtYc}`}
            />
          )}
        </td>
        {!isNhap && (
          <td>
            {!settled && (
              <div className="kna-lay">
                {dangLay.length === 0 ? (
                  <span className="kna-mo">Chưa lấy lô nào</span>
                ) : (
                  <>
                    <span className="kna-tag kna-tag--ma">{dangLay[0].voucher_ma ?? dangLay[0].ma_lo}</span>
                    {dangLay[0].vi_tri && <span className="kna-tag">{dangLay[0].vi_tri}</span>}
                    {dangLay.length > 1 && <span className="kna-tag">+{dangLay.length - 1} lô</span>}
                  </>
                )}
              </div>
            )}
            {ghiXuat && <div className={`kna-lay__ghi${ghiXuat.sai ? " kna-lay__ghi--sai" : ""}`}>{ghiXuat.chu}</div>}
          </td>
        )}
        {isNhap && (
          <td>
            {!settled && (
              <input className="kna-o kna-o--nho" value={block.viTri} list={viTriListId}
                onChange={(e) => onViTri(e.target.value)} placeholder="Kệ, ô" aria-label={`Vị trí cất ${block.matLabel}`} />
            )}
          </td>
        )}
        {isNhap && (
          <td>
            {!settled && (
              <ChonNgay className="kna-o kna-o--nho" value={block.hsd}
                onChange={(v) => onHsd(v)} aria-label={`Hạn dùng ${block.matLabel}`} />
            )}
          </td>
        )}
        {coGiay && <td>{!settled && l.hang_loai === "giay" ? khoGiayO : null}</td>}
        {isNhap && (
          <td className="n kna-so">
            {kcsChuaGia ? (
              <GiaGocKcs gia={null} />
            ) : block.donGia ? (
              money(Number(block.donGia))
            ) : (
              <span className="kna-mo">—</span>
            )}
          </td>
        )}
        <td className="n kna-so">
          {/* "≈" nhỏ phía trước khi số bị làm tròn (giá trị thật lẻ hơn); số tròn thì để nguyên. */}
          {settled || kcsChuaGia || !canViewCost ? (
            <span className="kna-mo">—</span>
          ) : slChuaGia > 0 && !(thanhTien > 0) ? (
            <GiaGocKcs gia={null} />
          ) : thanhTien > 0 ? (
            <>
              <ApproxMark raw={thanhTien} decimals={0} />
              {money(Math.round(thanhTien))}
              {slChuaGia > 0 && (
                <span className="kna-dv kna-dv--duoi">{fmtQty(slChuaGia)} {dvtGoc} chưa có giá gốc</span>
              )}
            </>
          ) : (
            <span className="kna-mo">—</span>
          )}
        </td>
        {hienGiaBan && (
          <td className="n kna-so">
            <GiaBanDong gia={l.don_gia_ban} dvt={l.dvt} donMa={l.don_ban_ma} />
          </td>
        )}
      </tr>

      {!settled && (isNhap ? quyDoiHint || lyDoBox : moThat) && (
        <tr className="kna-bang__phu">
          <td colSpan={soCot}>
            <div className={`kna-phu${isNhap ? "" : " kna-phu--lui"}`}>
              {isNhap ? (
                <>
                  {quyDoiHint}
                  {lyDoBox}
                </>
              ) : (
                <>
                  {block.thieu > 0 && (
                    <div className="kna-canh">
                      <AlertTriangle size={16} aria-hidden="true" />
                      {/* `tonCo` = tồn của mọi lô, ĐÃ quy về ĐƠN VỊ YÊU CẦU (khớp nhãn `l.dvt`). */}
                      <span>Kho chỉ còn {fmtQty(tonCo)} {dvtYc}. Phần còn lại chờ nhập hoặc tạo yêu cầu mới.</span>
                    </div>
                  )}
                  {/* Bảng lô: máy tự lấy lô hết hạn trước (goiYLo), kho sửa được ô "Lấy". Hiện theo MÃ
                      PHIẾU nhập (đợt hàng vào kho) thay mã lô kỹ thuật; tồn đầu kỳ thì lùi về mã lô. */}
                  <div className="lds-bang lds-bang--nhap">
                    <table className="lds-g">
                      <colgroup>
                        <col />
                        <col style={{ width: 96 }} />
                        <col style={{ width: 120 }} />
                        <col style={{ width: 104 }} />
                        <col style={{ width: 80 }} />
                        {canViewCost && <col style={{ width: 96 }} />}
                        <col style={{ width: 100 }} />
                      </colgroup>
                      <thead>
                        <tr>
                          <th>Lô (tự chọn lô hết hạn trước)</th>
                          <th>Nhập</th>
                          <th>Vị trí</th>
                          <th>Hạn dùng</th>
                          <th className="n">Còn</th>
                          {canViewCost && <th className="n">Đơn giá</th>}
                          <th className="n">Lấy</th>
                        </tr>
                      </thead>
                      <tbody>
                        {block.lots.length === 0 ? (
                          <tr>
                            <td colSpan={canViewCost ? 7 : 6} className="lds-trong">Không còn lô khả dụng trong kho này.</td>
                          </tr>
                        ) : (
                          block.lots.map((lot) => (
                            <tr key={lot.lot_id}>
                              <td>
                                <span className="kna-nguon">
                                  <span className="kna-tag kna-tag--ma">{lot.voucher_ma ?? lot.ma_lo}</span>
                                  {l.hang_loai === "giay" && <span>{nhanKhoGiay({ hang_loai: "giay", kho_rong: lot.kho_rong, kho_dai: lot.kho_dai })}</span>}
                                  {lot.order_ma && <span className="kna-tag">{lot.order_ma}</span>}
                                  {lot.khach_hang && <span>{lot.khach_hang}</span>}
                                  {lot.canh_bao && <span className="kna-tag kna-tag--canh">{lot.canh_bao}</span>}
                                </span>
                              </td>
                              <td className="kna-so">{fmtDateISO(lot.ngay_nhap)}</td>
                              <td>{lot.vi_tri ?? <span className="kna-mo">Chưa xếp</span>}</td>
                              <td>{lot.hsd ? <span className="kna-so">{fmtDateISO(lot.hsd)}</span> : <span className="kna-mo">Không hạn</span>}</td>
                              <td className="n kna-so">{fmtQty(lot.sl_con_lai)}</td>
                              {canViewCost && (
                                <td className="n kna-so">
                                  {lot.chua_gia_goc ? <GiaGocKcs gia={null} /> : lot.don_gia_nhap != null ? money(lot.don_gia_nhap) : ""}
                                </td>
                              )}
                              <td className="n">
                                <DecimalInput
                                  className={`kna-o kna-o--nho kna-o--so${block.warnLotId === lot.lot_id ? " kna-o--sai" : ""}`}
                                  value={lot.so_luong}
                                  onChange={(n) => onLotQty(lot.lot_id, n ?? 0)}
                                  aria-label={`Số lượng lấy từ ${lot.voucher_ma ?? lot.ma_lo}`}
                                />
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                  {block.warn ? (
                    <div className="kna-phu__goi kna-phu__goi--sai">{block.warn}</div>
                  ) : block.lots.length > 0 && dvtGoc !== dvtYc ? (
                    // Lô đếm theo đơn vị gốc — nói rõ để số ở ô "Lấy" khỏi bị đọc nhầm sang đơn vị yêu cầu.
                    <div className={`kna-phu__goi${matched ? " kna-phu__goi--ok" : ""}`}>
                      Lấy {fmtQty(chosen)} trên {fmtQty(targetGoc)} {dvtGoc} cần
                    </div>
                  ) : null}
                  {lyDoBox}
                </>
              )}
            </div>
          </td>
        </tr>
      )}
      {anhZoom && shownAnh && (
        <tr>
          <td colSpan={soCot} style={{ padding: 0, border: 0 }}>
            <div className="kho-anh__lightbox" role="dialog" aria-modal="true" onClick={() => setAnhZoom(false)}>
              <img src={shownAnh} alt={block.matLabel} onClick={(e) => e.stopPropagation()} />
              {!settled && (
                <div className="kna-anh-nut" onClick={(e) => e.stopPropagation()}>
                  <label className="kna-nut">
                    Đổi ảnh
                    <input type="file" accept="image/*" hidden onChange={chonAnh} />
                  </label>
                  <button type="button" className="kna-nut kna-nut--do" onClick={() => { onAnhClear(); setAnhZoom(false); }}>
                    Xoá ảnh
                  </button>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ── DRAWER: xem phiếu ────────────────────────────────────────────────────────
//
// Khuôn A (07/10/2026): tab Chi tiết | Chứng từ | Lịch sử. Cột chính = thẻ Dòng phiếu (kèm lô; phiếu
// nhập thêm Vị trí + Hạn dùng của lô vừa tạo); cột bên = thẻ Phiếu (theo yêu cầu, kho, ngày, người
// lập / ghi sổ — cùng người cùng lúc thì gộp "Lập và ghi sổ"), Nguồn hàng, Ghi chú.

/** Thẻ nguồn của một dòng phiếu: đơn / lệnh / khách (đọc ở lô gốc). */
function NguonDong({ l }: { l: StockVoucherLine }) {
  if (!l.order_ma && !l.lsx_ma && !l.khach_hang) return null;
  return (
    <>
      {l.order_ma && <span className="kna-tag kna-tag--ma">{l.order_ma}</span>}
      {l.lsx_ma && <span className="kna-tag kna-tag--ma">{l.lsx_ma}</span>}
      {l.khach_hang && <span>{l.khach_hang}</span>}
    </>
  );
}

/** "DH003 · LSX26-0006 · Công ty …" — chuỗi nguồn cho BẢN IN (giữ nguyên mẫu in cũ). */
function nguonDong(l: StockVoucherLine): string | null {
  return [l.order_ma, l.lsx_ma, l.khach_hang].filter(Boolean).join(" · ") || null;
}

export function VoucherDrawer({
  token,
  voucherId,
  canCreate,
  canPost,
  canViewCost,
  onClose,
  onChanged,
  tang,
}: {
  token: string;
  voucherId: number;
  canCreate: boolean;
  canPost: boolean;
  canViewCost: boolean;
  onClose: () => void;
  onChanged: () => void;
  /** Lớp chồng (0 = ngăn thường). */
  tang?: number;
}) {
  useNapTenDonVi();
  const [v, setV] = useState<StockVoucher | null>(null);
  // Bản in cần `sl_duyet` + ngày yêu cầu (mẫu 01-VT/02-VT có cột "Theo chứng từ") — hai thứ
  // này chỉ có trên yêu cầu, nên phiếu phải kéo kèm. Thẻ Nguồn hàng cũng đọc từ đây.
  const [req, setReq] = useState<StockRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [popupBlocked, setPopupBlocked] = useState(false);
  const [askCancel, setAskCancel] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [askPost, setAskPost] = useState(false);
  const [tab, setTab] = useState<"chi-tiet" | "chung-tu" | "lich-su">("chi-tiet");
  // Đính kèm hóa đơn/chứng từ gốc (ảnh hoặc PDF).
  const [attachments, setAttachments] = useState<StockVoucherAttachment[]>([]);
  const [attBusy, setAttBusy] = useState(false);
  const [attError, setAttError] = useState<string | null>(null);
  // Điều chỉnh phiếu XUẤT đã ghi sổ khi SX dùng ÍT hơn (xuất 10 → 7): sửa giảm số, trả dư về lô.
  const [adjusting, setAdjusting] = useState(false);
  const [adjQty, setAdjQty] = useState<Record<number, number>>({});
  const [adjLyDo, setAdjLyDo] = useState("");   // lý do điều chỉnh (BẮT BUỘC)

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.kho.phieu
      .get(token, voucherId)
      .then(async (voucher) => {
        if (cancelled) return;
        setV(voucher);
        const r = await api.kho.deNghi.get(token, voucher.request_id).catch(() => null);
        if (!cancelled) setReq(r);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Không tải được phiếu."))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, voucherId]);

  const loadAtt = useCallback(() => {
    api.kho.phieu
      .attachments(token, voucherId)
      .then((r) => setAttachments(r.items))
      .catch(() => {});
  }, [token, voucherId]);
  useEffect(loadAtt, [loadAtt]);

  // Lịch sử ĐIỀU CHỈNH phiếu xuất (ai · bộ phận · lúc nào · đổi gì) — vào tab Lịch sử.
  const [dcHistory, setDcHistory] = useState<DieuChinhLichSu[]>([]);
  const loadDcHistory = useCallback(() => {
    api.kho.phieu
      .lichSuDieuChinh(token, voucherId)
      .then(setDcHistory)
      .catch(() => setDcHistory([]));
  }, [token, voucherId]);
  useEffect(loadDcHistory, [loadDcHistory]);

  async function uploadAtt(file: File) {
    setAttBusy(true);
    setAttError(null);
    try {
      await api.kho.phieu.uploadAttachment(token, voucherId, file);
      loadAtt();
    } catch (e) {
      setAttError(e instanceof ApiError ? e.message : "Không tải được file lên.");
    } finally {
      setAttBusy(false);
    }
  }
  async function removeAtt(attId: number) {
    setAttBusy(true);
    setAttError(null);
    try {
      await api.kho.phieu.deleteAttachment(token, voucherId, attId);
      loadAtt();
    } catch (e) {
      setAttError(e instanceof ApiError ? e.message : "Không xóa được file.");
    } finally {
      setAttBusy(false);
    }
  }

  function doPrint() {
    if (!v) return;
    const data: StockVoucherPrintData = {
      kind: v.loai === "NHAP" ? "nhap" : "xuat",
      docNo: v.ma,
      docDate: v.ngay,
      debitAccount: null,
      creditAccount: null,
      boPhan: req?.bo_phan_ten ?? null,
      nguoiGiaoNhan: v.nguoi_giao_nhan,
      chungTuGoc: v.request_ma,
      chungTuGocNgay: req ? fmtDate(req.created_at) : null,
      nguoiDeNghi: req?.nguoi_tao_ten ?? null,
      nguoiLapPhieu: v.nguoi_lap_ten ?? null,
      khoTen: v.kho_ten,
      diaDiem: null,
      lyDo: v.ghi_chu,
      // In ẩn GIÁ nghiêm theo quyền `view_cost`: KHÔNG có quyền → bỏ Đơn giá/Thành tiền/Tổng (template
      // tự ẩn 2 cột khi donGia null). API cũng đã xoá số khi thiếu quyền; gate thêm ở đây cho chắc.
      tongTien: canViewCost ? v.gia_von : null,
      cancelled: v.trang_thai === "cancelled",
      lines: v.lines.map((l) => ({
        materialCode: l.hang_ma,
        materialName: l.hang_ten,
        maLo: l.ma_lo,
        dvt: tenDonVi(l.dvt) ?? l.dvt,   // TÊN có dấu (tờ/bản kẽm) thay MÃ (to/kem) — khớp bản in điều chuyển
        soLuongChungTu: req?.lines.find((x) => x.id === l.request_line_id)?.sl_duyet ?? null,
        soLuong: l.so_luong,
        donGia: canViewCost ? l.don_gia : null,
        thanhTien: canViewCost ? l.thanh_tien : null,
        chuaGiaGoc: canViewCost && !!l.chua_gia_goc,
        nguon: nguonDong(l),
      })),
    };
    setPopupBlocked(!printStockVoucher(data));
  }

  // Cột giá chỉ hiện khi backend THẬT SỰ trả giá (chỉ người có `view_cost`, kho_voucher.py) ⇒ không
  // dựng hai cột Đơn giá/Thành tiền trống. Có quyền thì `gia_von` luôn là số.
  const hienGia = canViewCost && v?.gia_von != null;
  // Giá bán (tham khảo) là cột RIÊNG, chỉ dựng khi có dòng mang giá bán — phiếu mua hàng không có.
  const hienGiaBan = hienGia && !!v?.lines.some((l) => l.don_gia_ban != null);
  // Còn dòng thành phẩm KCS chưa có giá gốc ⇒ tổng giá vốn chưa trọn, đừng in như một con số chốt.
  const thieuGiaGoc = !!v?.lines.some((l) => l.chua_gia_goc);
  const nhap = v?.loai === "NHAP";
  // Phiếu nhập thành phẩm KCS: đơn, lệnh, khách đã ở thẻ Nguồn hàng ⇒ ô Vật tư khỏi lặp lại (chỉ khi
  // cả phiếu chung MỘT đơn / lệnh / khách — trộn nhiều nguồn thì dòng nào ghi nguồn dòng đó).
  const laKcs = !!req && tuKcs(req);
  const motGiaTri = (ds: (string | null | undefined)[]) => new Set(ds.filter(Boolean)).size <= 1;
  const nguonOThe = laKcs && !!v && motGiaTri(v.lines.map((l) => l.order_ma))
    && motGiaTri(v.lines.map((l) => l.lsx_ma)) && motGiaTri(v.lines.map((l) => l.khach_hang));
  const khachThe = nguonOThe ? v?.lines.find((l) => l.khach_hang)?.khach_hang ?? null : null;
  const hienLo = !!v?.lines.some((l) => l.ma_lo);
  // Phiếu nhập: lô vừa tạo cất ở đâu, hạn dùng bao giờ — thứ kho cần khi đi tìm hàng.
  const hienCat = nhap && !!v?.lines.some((l) => l.vi_tri || l.hsd);
  // Vị trí cất là của LÔ ⇒ nằm dòng phụ dưới mã lô, không chiếm cột riêng (bảng 7 cột tràn ngăn 1180px).
  const cotLo = hienLo || hienCat;
  const soCot = 2 + (cotLo ? 1 : 0) + (hienCat ? 1 : 0) + (hienGia ? 2 : 0) + (hienGiaBan ? 1 : 0);
  // Nhiều lô của CÙNG một dòng yêu cầu đứng liền nhau ⇒ ô mặt hàng gộp dọc (rowSpan) cho khỏi lặp tên.
  const nhom = useMemo(() => {
    const out: { l: StockVoucherLine; span: number }[] = [];
    (v?.lines ?? []).forEach((l, i, ds) => {
      if (i > 0 && ds[i - 1].request_line_id === l.request_line_id) {
        out.push({ l, span: 0 });
        let j = out.length - 1;
        while (j > 0 && out[j].span === 0) j -= 1;
        out[j].span += 1;
      } else out.push({ l, span: 1 });
    });
    return out;
  }, [v]);

  async function act(fn: () => Promise<StockVoucher>, fallback: string) {
    setBusy(true);
    setError(null);
    try {
      setV(await fn());
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : fallback);
    } finally {
      setBusy(false);
    }
  }

  function startAdjust() {
    if (!v) return;
    const seed: Record<number, number> = {};
    v.lines.forEach((l) => { seed[l.id] = l.so_luong; });
    setAdjQty(seed);
    setAdjLyDo("");
    setError(null);
    setTab("chi-tiet");
    setAdjusting(true);
  }
  async function saveAdjust() {
    if (!v) return;
    // Chỉ gửi dòng THỰC SỰ giảm; số mới phải > 0 (bỏ hẳn cả dòng không phải việc ở đây).
    const lines = v.lines
      .filter((l) => (adjQty[l.id] ?? l.so_luong) < l.so_luong - 1e-9)
      .map((l) => ({ line_id: l.id, so_luong_moi: adjQty[l.id] ?? l.so_luong }));
    if (lines.length === 0) {
      setError("Chưa giảm dòng nào. Sửa số ở cột Số lượng cho nhỏ hơn rồi lưu.");
      return;
    }
    if (lines.some((x) => x.so_luong_moi <= 0)) {
      setError("Số lượng mới phải lớn hơn 0.");
      return;
    }
    if (!adjLyDo.trim()) {
      setError("Phải nhập lý do sửa.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setV(await api.kho.phieu.dieuChinhXuat(token, v.id, lines, adjLyDo.trim()));
      setAdjusting(false);
      loadDcHistory();   // hiện ngay dòng lịch sử vừa tạo
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Không điều chỉnh được phiếu.");
    } finally {
      setBusy(false);
    }
  }

  // Lịch sử của PHIẾU: lập, ghi sổ (gộp khi cùng người cùng lúc), từng lần điều chỉnh, hủy.
  const lichSu: MucLichSu[] = [];
  if (v) {
    const gop = lapVaGhiSoCungLuc(v);
    lichSu.push({
      kieu: gop ? "xong" : "tao", luc: v.created_at,
      tieuDe: <><b>{v.nguoi_lap_ten ?? "Kho"}</b> {gop ? "lập và ghi sổ" : "lập"} phiếu{v.request_ma ? <> theo <b>{v.request_ma}</b></> : null}</>,
    });
    if (v.trang_thai === "posted" && v.ghi_so_luc && !gop) {
      lichSu.push({ kieu: "xong", luc: v.ghi_so_luc, tieuDe: <><b>{v.nguoi_ghi_so_ten ?? "Kho"}</b> ghi sổ phiếu</> });
    }
    for (const h of dcHistory) {
      lichSu.push({
        kieu: "canh", luc: h.thoi_diem,
        tieuDe: <><b>{h.nguoi_ten ?? "—"}</b> sửa số xuất nhầm</>,
        phu: h.bo_phan_ten ?? undefined,
        trich: (h.chi_tiet || h.ly_do) ? <>{h.chi_tiet && <div>{h.chi_tiet}</div>}{h.ly_do && <div>Lý do: {h.ly_do}</div>}</> : undefined,
      });
    }
    if (v.trang_thai === "cancelled") lichSu.push({ kieu: "huy", tieuDe: <>Phiếu đã hủy</> });
    lichSu.sort((a, b) => (b.luc ? new Date(b.luc).getTime() : Infinity) - (a.luc ? new Date(a.luc).getTime() : Infinity));
  }

  const suaChungTu = canCreate && v != null && v.trang_thai !== "cancelled";

  return (
    <>
      <NganPhai
        tang={tang}
        duongDan={<span>{v ? (v.dieu_chuyen ? "Phiếu điều chuyển" : nhap ? "Phiếu nhập kho" : "Phiếu xuất kho") : "Phiếu kho"}</span>}
        tieuDe={v?.ma ?? "Đang tải…"}
        the={v ? <VoucherStatusBadge status={v.trang_thai} /> : undefined}
        hanhDong={
          v ? (
            adjusting ? (
              <>
                <button type="button" className="kna-nut kna-nut--nhat" onClick={() => setAdjusting(false)} disabled={busy}>
                  Hủy sửa
                </button>
                <button type="button" className="kna-nut kna-nut--chinh" onClick={saveAdjust} disabled={busy}>
                  {busy ? "Đang lưu…" : "Lưu số đã sửa"}
                </button>
              </>
            ) : (
              <>
                {/* HỦY phiếu chờ ghi sổ — quyền của người ghi sổ. */}
                {canPost && v.trang_thai === "draft" && (
                  <button type="button" className="kna-nut kna-nut--nhat kna-nut--do"
                    onClick={() => { setCancelReason(""); setAskCancel(true); }}>
                    Hủy phiếu
                  </button>
                )}
                {/* Sửa số xuất nhầm trên phiếu XUẤT ĐÃ ghi sổ (11/10/2026: hàng SX dùng thừa thì tổ trả
                    bằng Yêu cầu nhập kho, không qua đây) — KHÔNG cho phiếu điều chuyển (vế
                    nội bộ cặp đôi, sửa lệch vỡ cân đối 2 kho; muốn khác thì điều chuyển ngược lại). */}
                {canCreate && v.loai === "XUAT" && v.trang_thai === "posted" && !v.dieu_chuyen && (
                  <button type="button" className="kna-nut" onClick={startAdjust}>
                    <Pencil size={15} aria-hidden="true" />Sửa số xuất nhầm
                  </button>
                )}
                {/* In được ở mọi trạng thái (kể cả chờ ghi sổ và đã hủy). */}
                <button type="button" className="kna-nut" onClick={doPrint}>
                  <Printer size={15} aria-hidden="true" />In phiếu
                </button>
                {canPost && v.trang_thai === "draft" && (
                  <button type="button" className="kna-nut kna-nut--chinh" onClick={() => setAskPost(true)} disabled={busy}>
                    Ghi sổ
                  </button>
                )}
              </>
            )
          ) : undefined
        }
        tabs={[
          { id: "chi-tiet", nhan: "Chi tiết" },
          { id: "chung-tu", nhan: "Chứng từ", dem: attachments.length || undefined },
          { id: "lich-su", nhan: "Lịch sử" },
        ]}
        tab={tab}
        onTab={(id) => setTab(id as typeof tab)}
        onDong={onClose}
      >
        <div className="kna">
          {popupBlocked && (
            <div className="banner banner--warn" role="alert">
              <span>Trình duyệt đã chặn cửa sổ in. Cho phép pop-up cho trang này rồi bấm In lại.</span>
            </div>
          )}
          {error && (
            <div className="banner banner--error" role="alert">
              <span>{error}</span>
            </div>
          )}
          {loading || !v ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
              {Array.from({ length: 4 }).map((_, i) => (
                <span key={i} className="rc-skel" style={{ width: `${90 - i * 12}%` }} />
              ))}
            </div>
          ) : tab === "lich-su" ? (
            <LichSuA muc={lichSu} />
          ) : tab === "chung-tu" ? (
            <TheA tieuDe="Chứng từ gốc">
              <div className="kna-the__than">
                {attError && (
                  <div className="banner banner--error" role="alert" style={{ marginBottom: 10 }}>
                    <span>{attError}</span>
                  </div>
                )}
                {attachments.length > 0 && (
                  <ul className="kna-tep">
                    {attachments.map((a) => (
                      <li key={a.id}>
                        <FileText size={16} aria-hidden="true" />
                        <a href={assetUrl(a.file_url) ?? "#"} target="_blank" rel="noreferrer">{a.file_name}</a>
                        {suaChungTu && (
                          <button type="button" aria-label={`Xóa ${a.file_name}`} disabled={attBusy} onClick={() => removeAtt(a.id)}>
                            <Icon name="x" size={14} />
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {suaChungTu ? (
                  <label className={`kna-tha${attBusy ? " kna-tha--khoa" : ""}`}>
                    {attBusy ? "Đang tải lên…" : <><b>Thêm ảnh hoặc PDF</b> {nhap ? "hoá đơn, phiếu giao của nhà cung cấp." : "chứng từ kèm phiếu."}</>}
                    <input type="file" accept="image/*,application/pdf" hidden disabled={attBusy}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void uploadAtt(f);
                        e.target.value = "";
                      }} />
                  </label>
                ) : attachments.length === 0 ? (
                  <p className="kna-mo" style={{ margin: 0 }}>Chưa có chứng từ.</p>
                ) : null}
              </div>
            </TheA>
          ) : (
            <div className="kna-luoi">
              <div className="kna-cot">
                <TheA cat tieuDe="Dòng phiếu">
                  {adjusting && (
                    <div className="kna-the__than" style={{ paddingBottom: 0 }}>
                      <div className="kna-canh kna-canh--xanh" style={{ marginBottom: 10 }}>
                        <span>Xuất nhầm số? Sửa <b>giảm</b> ô Số lượng từng dòng. Phần dư trả về lô nguồn, yêu cầu tính lại phần còn thiếu. Hàng sản xuất dùng thừa thì để tổ trả bằng Yêu cầu nhập kho.</span>
                      </div>
                      <label className="kna-o-truong">
                        <span>Lý do sửa <em>*</em></span>
                        <input className={`kna-o${adjLyDo.trim() ? "" : " kna-o--loi"}`} value={adjLyDo}
                          onChange={(e) => setAdjLyDo(e.target.value)}
                          placeholder="Ví dụ: sản xuất chỉ dùng 7, trả 3 về kho" />
                      </label>
                    </div>
                  )}
                  <div className="lds-bang">
                    {/* Cột cố định cộng lại + 160 cho cột Vật tư: chật hơn bề ngang ngăn thì khung tự cuộn ngang. */}
                    <table className="lds-g" style={{ minWidth: 160 + (adjusting ? 190 : 96) + (cotLo ? 130 : 0) + (hienCat ? 100 : 0) + (hienGia ? 206 : 0) + (hienGiaBan ? 124 : 0) }}>
                      <colgroup>
                        <col />
                        {cotLo && <col style={{ width: 130 }} />}
                        {hienCat && <col style={{ width: 100 }} />}
                        <col style={{ width: adjusting ? 190 : 96 }} />
                        {hienGia && <col style={{ width: 96 }} />}
                        {hienGia && <col style={{ width: 110 }} />}
                        {hienGiaBan && <col style={{ width: 124 }} />}
                      </colgroup>
                      <thead>
                        <tr>
                          <th>Vật tư</th>
                          {cotLo && <th>{hienCat ? "Lô và vị trí" : nhap ? "Lô tạo ra" : "Lô"}</th>}
                          {hienCat && <th>Hạn dùng</th>}
                          <th className="n">Số lượng</th>
                          {hienGia && <th className="n">{laKcs ? "Giá gốc" : "Đơn giá"}</th>}
                          {hienGia && <th className="n">{nhap ? "Thành tiền" : "Giá vốn"}</th>}
                          {hienGiaBan && <th className="n">Giá bán</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {nhom.map(({ l, span }) => (
                          <tr key={l.id} className={span > 1 ? "kna-bang__nhom" : undefined}>
                            {span > 0 && (
                              <td rowSpan={span}>
                                <HangA ten={l.hang_ten ?? "—"}
                                  phu={<>
                                    {l.hang_ma && <span className="kna-tag kna-tag--ma">{l.hang_ma}</span>}
                                    {nhanKhoGiay(l) && <span>{nhanKhoGiay(l)}</span>}
                                    {!nguonOThe && <NguonDong l={l} />}
                                  </>} />
                              </td>
                            )}
                            {cotLo && (
                              <td className="kna-o-lo">
                                {l.ma_lo ? <span className="kna-tag kna-tag--ma">{l.ma_lo}</span> : <span className="kna-mo">—</span>}
                                {hienCat && (
                                  <div className={l.vi_tri ? "kna-tl__m" : "kna-tl__m kna-mo"}>{l.vi_tri ?? "Chưa xếp"}</div>
                                )}
                              </td>
                            )}
                            {hienCat && <td>{l.hsd ? <span className="kna-so">{fmtDateISO(l.hsd)}</span> : <span className="kna-mo">Không hạn</span>}</td>}
                            <td className="n">
                              {adjusting ? (
                                <span className="kna-sl">
                                  <DecimalInput
                                    className="kna-o kna-o--so"
                                    value={adjQty[l.id] ?? l.so_luong}
                                    aria-label={`Số lượng thực dùng ${l.hang_ten ?? ""}`}
                                    onChange={(n) => setAdjQty((m) => ({ ...m, [l.id]: n ?? 0 }))}
                                  />
                                  <span className="kna-dv">/ {fmtQty(l.so_luong)}</span>
                                </span>
                              ) : (
                                <SoA so={l.so_luong} dv={tenDv(l.dvt)} />
                              )}
                            </td>
                            {hienGia && (
                              <td className="n kna-so">
                                {l.chua_gia_goc ? <GiaGocKcs gia={null} /> : l.don_gia != null ? money(l.don_gia) : ""}
                              </td>
                            )}
                            {hienGia && (
                              <td className="n kna-so">
                                {l.chua_gia_goc ? <span className="kna-mo">Chưa tính</span> : l.thanh_tien != null ? money(l.thanh_tien) : ""}
                              </td>
                            )}
                            {hienGiaBan && (
                              <td className="n kna-so">
                                <GiaBanDong gia={l.don_gia_ban ?? null} dvt={l.dvt ?? ""} />
                              </td>
                            )}
                          </tr>
                        ))}
                        {hienGia && v.gia_von != null && (
                          <tr className="lds-cong">
                            <td colSpan={soCot - 1 - (hienGiaBan ? 1 : 0)}>
                              {nhap ? "Tổng tiền nhập" : "Tổng giá vốn"}
                              {thieuGiaGoc && v.gia_von > 0 && <span className="kna-dv">chưa gồm hàng chưa có giá gốc</span>}
                            </td>
                            {/* Cùng chữ với ô Thành tiền của dòng — câu dài tràn sang ô Giá bán. */}
                            <td className="n kna-so">{thieuGiaGoc && v.gia_von === 0 ? <span className="kna-mo">Chưa tính</span> : money(v.gia_von)}</td>
                            {hienGiaBan && <td />}
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </TheA>
              </div>

              <div className="kna-cot">
                <TheA tieuDe="Phiếu">
                  <div className="kna-the__than">
                    <KvA dong={[
                      v.request_ma ? ["Theo yêu cầu", <span className="kna-tag kna-tag--ma">{v.request_ma}</span>] : null,
                      [nhap ? "Nhập về kho" : "Xuất từ kho", v.kho_ten ?? "—"],
                      [nhap ? "Ngày nhập" : "Ngày xuất", <span className="kna-so">{fmtDateISO(v.ngay)}</span>],
                      v.nguoi_giao_nhan ? [nhap ? "Người giao hàng" : "Người nhận hàng", v.nguoi_giao_nhan] : null,
                      v.nguoi_de_nghi_ten ? ["Người yêu cầu", v.nguoi_de_nghi_ten, req?.bo_phan_ten ? <small>{req.bo_phan_ten}</small> : null] : null,
                      v.loai_kho ? ["Loại nhập xuất", v.loai_kho] : null,
                      ...(lapVaGhiSoCungLuc(v)
                        ? [["Lập và ghi sổ", v.nguoi_lap_ten ?? "—", <small className="kna-so">{fmtDateTime(v.ghi_so_luc ?? v.created_at)}</small>] as [ReactNode, ReactNode, ReactNode]]
                        : [
                            ["Người lập", v.nguoi_lap_ten ?? "—", <small className="kna-so">{fmtDateTime(v.created_at)}</small>] as [ReactNode, ReactNode, ReactNode],
                            (v.ghi_so_luc
                              ? ["Ghi sổ", v.nguoi_ghi_so_ten ?? "—", <small className="kna-so">{fmtDateTime(v.ghi_so_luc)}</small>]
                              : ["Ghi sổ", <span className="kna-mo">{v.trang_thai === "cancelled" ? "Không ghi sổ" : "Chưa ghi sổ"}</span>]) as [ReactNode, ReactNode, ReactNode?],
                          ]),
                    ]} />
                  </div>
                </TheA>
                {req && <TheNguonHang r={req} khach={khachThe} />}
                {v.ghi_chu && (
                  <TheA tieuDe="Ghi chú">
                    <div className="kna-the__than kna-ghi">{v.ghi_chu}</div>
                  </TheA>
                )}
              </div>
            </div>
          )}
        </div>
      </NganPhai>

      <ConfirmDialog
        open={askPost}
        title={v?.loai === "NHAP" ? "Ghi sổ phiếu nhập kho?" : "Ghi sổ phiếu xuất kho?"}
        message={
          v?.loai === "NHAP"
            ? "Tồn kho sẽ cộng ngay và phiếu không sửa được nữa."
            : "Tồn kho sẽ trừ ngay và phiếu không sửa được nữa."
        }
        confirmLabel="Ghi sổ"
        busy={busy}
        onCancel={() => setAskPost(false)}
        onConfirm={() => {
          setAskPost(false);
          if (v) void act(() => api.kho.phieu.ghiSo(token, v.id), "Không ghi sổ được phiếu.");
        }}
      />

      <ConfirmDialog
        open={askCancel}
        title="Hủy phiếu này?"
        message="Yêu cầu sẽ chuyển sang 'Đã hủy' kèm lý do và KHÔNG cấp lại. Phiếu vẫn giữ số & in được, nhưng không ghi sổ được nữa."
        confirmLabel="Hủy phiếu"
        cancelLabel="Giữ lại"
        danger
        busy={busy}
        confirmDisabled={!cancelReason.trim()}
        onCancel={() => setAskCancel(false)}
        onConfirm={() => {
          const ly = cancelReason.trim();
          if (!ly || !v) return;
          setAskCancel(false);
          void act(() => api.kho.phieu.huy(token, v.id, ly), "Không hủy được phiếu.");
        }}
      >
        <label className="rc-field">
          <span className="rc-field__label">
            Lý do hủy <em>*</em>
          </span>
          <textarea
            className="rc-textarea"
            rows={3}
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            placeholder="Vì sao hủy yêu cầu này? (bắt buộc)"
            autoFocus
          />
        </label>
      </ConfirmDialog>
    </>
  );
}

// ── DRAWER: ngưỡng tồn ───────────────────────────────────────────────────────

export function ThresholdDrawer({
  token,
  khoList,
  initialKhoId,
  onClose,
}: {
  token: string;
  khoList: KhoOption[];
  initialKhoId: number | null;
  onClose: () => void;
}) {
  const [khoId, setKhoId] = useState<number | null>(initialKhoId);
  // Mặt hàng gốc đang khai ngưỡng. Giữ cả `ten` để ô chọn hiện lại tên sau khi chọn.
  const [hang, setHang] = useState<{ loai: HangLoai; id: number; ten: string } | null>(null);
  const [nguongTon, setNguongTon] = useState("");
  const [nguongToiDa, setNguongToiDa] = useState("");
  const [canhBao, setCanhBao] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  // Ngưỡng đã lưu, key = "kho:vật tư" — để CHỌN VẬT TƯ NÀO thì nạp sẵn ngưỡng của vật tư đó.
  const [thByKey, setThByKey] = useState<Record<string, StockThreshold>>({});

  useEffect(() => {
    api.kho.nguongTon
      .list(token)
      .then((ths) => {
        const m: Record<string, StockThreshold> = {};
        for (const t of ths) m[`${t.kho_id}:${t.hang_loai}:${t.hang_id}`] = t;
        setThByKey(m);
      })
      .catch(() => {});
  }, [token]);

  // Chọn mặt hàng (+ kho) → nạp ngưỡng đã khai của món đó; chưa khai thì để trống (khai mới).
  useEffect(() => {
    if (hang == null || khoId == null) return;
    const t = thByKey[`${khoId}:${hang.loai}:${hang.id}`];
    setNguongTon(t?.nguong_ton != null ? String(t.nguong_ton) : "");
    setNguongToiDa(t?.nguong_toi_da != null ? String(t.nguong_toi_da) : "");
    setCanhBao(t?.canh_bao ?? true);
    setOk(false);
  }, [hang, khoId, thByKey]);

  async function save() {
    if (hang == null || khoId == null) {
      setError("Chọn vật tư và kho trước khi lưu.");
      return;
    }
    const ton = Number(nguongTon);
    if (!Number.isFinite(ton) || ton < 0) {
      setError("Ngưỡng tồn phải là số không âm.");
      return;
    }
    const max = nguongToiDa === "" ? null : Number(nguongToiDa);
    if (max != null && max < ton) {
      setError("Ngưỡng tối đa phải lớn hơn hoặc bằng ngưỡng tồn.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const t = await api.kho.nguongTon.upsert(token, {
        hang_loai: hang.loai,
        hang_id: hang.id,
        kho_id: khoId,
        nguong_ton: ton,
        nguong_can_ton: null,
        nguong_toi_da: max,
        canh_bao: canhBao,
      });
      setThByKey((prev) => ({ ...prev, [`${khoId}:${hang.loai}:${hang.id}`]: t }));
      setOk(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Không lưu được ngưỡng tồn.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rc-drawer__scrim" role="dialog" aria-modal="true" onClick={onClose}>
      <aside className="rc-drawer rc-drawer--mid" onClick={(e) => e.stopPropagation()}>
        <header className="rc-drawer__head">
          <div>
            <div className="rc-drawer__kicker">CẤU HÌNH KHO</div>
            <h2 className="rc-drawer__title">Ngưỡng tồn</h2>
          </div>
          <button type="button" className="rc-drawer__x" onClick={onClose} aria-label="Đóng">
            <Icon name="x" size={16} />
          </button>
        </header>

        <div className="rc-drawer__body">
          {error && (
            <div className="banner banner--error" role="alert">
              <span>{error}</span>
            </div>
          )}
          {ok && (
            <div className="banner banner--success" role="status">
              <span>Đã lưu ngưỡng cho vật tư này.</span>
            </div>
          )}

          <section className="rc-sec">
            <h3 className="rc-sec__title">Áp cho</h3>
            <div className="rc-grid">
              <div className="rc-field">
                <span className="rc-field__label">Vật tư</span>
                {/* Cùng ô chọn với dòng yêu cầu — một cách chọn mặt hàng cho cả module, khỏi hai
                    kiểu tìm khác nhau cho cùng một danh mục. Ngưỡng khai theo ĐƠN VỊ GỐC. */}
                <MaterialCombobox
                  token={token}
                  hangTen={hang?.ten ?? null}
                  onPick={(m) => {
                    setHang({ loai: m.hang_loai, id: m.hang_id, ten: m.ten });
                    setOk(false);
                  }}
                  placeholder="Tìm mã / tên vật tư…"
                />
              </div>
              <div className="rc-field">
                <span className="rc-field__label">Kho</span>
                <Select
                  portal
                  options={khoList.map((w) => ({ value: w.id, label: w.ten, hint: w.ma }))}
                  value={khoId}
                  onChange={(v) => setKhoId(v == null ? null : Number(v))}
                  ariaLabel="Kho"
                />
              </div>
            </div>
          </section>

          <section className="rc-sec">
            <h3 className="rc-sec__title">Ba ngưỡng</h3>
            <div className="rc-grid">
              <div className="rc-field">
                <label className="rc-field__label" htmlFor="ng-ton">
                  Ngưỡng tồn <em>*</em>
                </label>
                <input
                  id="ng-ton"
                  type="number"
                  min={0}
                  step="any"
                  className="rc-input kho-num"
                  value={nguongTon}
                  onChange={(e) => setNguongTon(e.target.value)}
                />
                <p className="rc-field__hint">Dưới mức này là "Cần mua".</p>
              </div>
              <div className="rc-field">
                <label className="rc-field__label" htmlFor="ng-max">
                  Ngưỡng tối đa
                </label>
                <input
                  id="ng-max"
                  type="number"
                  min={0}
                  step="any"
                  className="rc-input kho-num"
                  value={nguongToiDa}
                  onChange={(e) => setNguongToiDa(e.target.value)}
                />
                <p className="rc-field__hint">Vượt mức này báo "Dư" (đọng vốn).</p>
              </div>
              <div className="rc-field rc-field--check">
                <span className="rc-field__label">Bật cảnh báo</span>
                <label className="rc-switch">
                  <input
                    type="checkbox"
                    checked={canhBao}
                    onChange={(e) => setCanhBao(e.target.checked)}
                  />
                  <span className="rc-switch__slider" />
                </label>
              </div>
            </div>
          </section>
        </div>

        <footer className="rc-drawer__foot">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Đóng
          </button>
          <Button variant="accent" loading={busy} onClick={save}>
            Lưu ngưỡng
          </Button>
        </footer>
      </aside>
    </div>
  );
}
