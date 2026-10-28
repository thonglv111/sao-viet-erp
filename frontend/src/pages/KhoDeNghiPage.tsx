// Màn "Yêu cầu nhập xuất" — người YÊU CẦU (tổ trưởng SX, NV sản xuất, QL sản xuất, NV mua hàng).
//
// Ranh giới của màn này là ranh giới QUYỀN: người yêu cầu KHÔNG thấy số tồn, KHÔNG thấy giá,
// KHÔNG thấy lô, KHÔNG chọn kho. Yêu cầu chỉ nói "xin cái gì, bao nhiêu"; kho nào là quyết định
// ở BƯỚC LẬP PHIẾU (thủ kho). SIẾT 2026-08-08: mặt hàng phải có sẵn trong danh mục Giấy / Vật
// tư khác — không còn gõ tên tự do rồi kho gắn mã sau.
import { ChonGio, ChonNgay } from "../components/ChonNgay";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  ApiError,
  api,
  type HangLoai,
  type MatHangOption,
  type StockRequest,
  type StockRequestKind,
  type StockRequestLine,
  type StockRequestLineInput,
  type StockRequestStatus,
  type TonKhoaRow,
} from "../api/client";
import { KhungKho } from "../components/kho-giay/KhungKho";
import { nhanKho } from "../components/kho-giay/tienIchKho";
import { useHep } from "../lib/useHep";
import { NganPhai } from "./ke-toan/shared/NganPhai";
import "./ke-toan/ke-toan.css";
import "./kho-ngan-a.css";
import "./kho/kho-form-dien-thoai.css";
import "./mua-hang/yeu-cau-mua-hang/components/yc-form-a.css";
import "./mua-hang/yeu-cau-mua-hang/components/yc-ds-a.css";
import "./mua-hang/phieu-mua-hang/components/don-form-a.css";
import { InboxRequestDrawer, VoucherDrawer } from "./KhoYeuCauPage";
import { NguonA, TienDoA, canLucCua } from "./khoNganA";
import { useAuth } from "../auth/useAuth";
import { useCan } from "../auth/permissions";
import { Button } from "../components/Button";
import { Icon } from "../components/Icons";
import { DonViChonTheoHang, MaterialCombobox } from "../components/MaterialCombobox";
import { PhanTrangDayDu } from "../components/PhanTrangDayDu";
import { OSoLe } from "../components/OSoLe";
import { chuanKho, coDonViGoc, coKho, gocDongXin, tenGoc } from "../lib/khoGiay";
import { fmtDate, fmtDateISO, fmtDateTime } from "../utils/format";
import { congNgay } from "../utils/ky";
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
import { thamSoKy } from "./thanh-loc/ky-danh-sach";
import { dkTheoTab, soDaAp, type DieuKien } from "./thanh-loc/thanh-loc";
import { useLocMan } from "./thanh-loc/useLocMan";
import { REQUEST_STATUS, DEFAULT_PAGE_SIZE, fmtQty, isOverdue, todayISO } from "./khoShared";
import {
  CuonLuoi, ChipTT, ChonCot, LocNhanhTrangThai, OTim,
  rongLuoi, useCauHinhLuoi, type CotLuoi, type MauTT,
} from "../components/LuoiDs";
import { EmptyRow } from "../components/EmptyState";
import { tenDonVi, useNapTenDonVi } from "./tenDonVi";
import "./rebuild-catalog.css";
import "./kho-request.css";

type TabId = "all" | "dang-cap" | "done" | "khong-thanh";

// BỎ BƯỚC DUYỆT: tạo yêu cầu là 'approved' NGAY → không còn 'draft'/'pending' để lọc, bỏ luôn tab
// "Chờ duyệt". Yêu cầu mới rơi thẳng vào "Đang cấp".
const TAB_STATUSES: Record<Exclude<TabId, "all">, StockRequestStatus[]> = {
  "dang-cap": ["approved", "received", "preparing", "partial"],
  done: ["done"],
  "khong-thanh": ["rejected", "cancelled"],
};

export function KhoDeNghiPage({
  eventTick = 0,
  dieuChuyen = false,
  initialSeed = null,
  onSeedConsumed,
  unseenDone = 0,
  unseenFail = 0,
  onSeen,
  openRequestId = null,
  onOpenRequestConsumed,
  slotNut = null,
}: {
  eventTick?: number;
  /** Chỗ trong đầu trang chung của `KhoPage` (`lds-dau__nut`) để đặt nút "Tạo yêu cầu": nút cần
   *  state ngăn của màn này nên được vẽ vào đó bằng portal, không nâng state lên vỏ. */
  slotNut?: HTMLElement | null;
  /** Tab ĐIỀU CHUYỂN: chỉ hiện yêu cầu điều chuyển (dieu_chuyen=true) + ẩn nút "Tạo yêu cầu"
   *  (điều chuyển tạo từ màn Tồn kho, không tạo tay ở đây). */
  dieuChuyen?: boolean;
  /** Điều hướng kèm dữ liệu → mở sẵn form TẠO đã điền (vd "Nhập kho" từ đợt giao đơn mua). */
  initialSeed?: KhoNhapSeed | null;
  /** Báo cha đã tiêu thụ seed (xoá đi để không mở lại khi remount). */
  onSeedConsumed?: () => void;
  /** Phản hồi kho CHƯA XEM của người tạo → số đỏ cạnh bộ lọc Hoàn tất / Không thành. */
  unseenDone?: number;
  unseenFail?: number;
  /** Sau khi mở xem 1 yêu cầu (đã đánh dấu đã xem) → refetch badge/số đỏ ở AppShell. */
  onSeen?: () => void;
  /** Bấm thông báo → mở sẵn drawer đúng yêu cầu này (id). */
  openRequestId?: number | null;
  onOpenRequestConsumed?: () => void;
}) {
  const { token, user } = useAuth();
  const can = useCan();
  // Cột Tiến độ in tên đơn vị ("tờ") chứ không in mã (`to_tp`) — nạp bảng tên đơn vị cho danh sách.
  useNapTenDonVi();
  const luoi = useCauHinhLuoi("kho-yeu-cau");
  const canRequest = can("kho", "request");

  const [rows, setRows] = useState<StockRequest[]>([]);
  const [totalCount, setTotalCount] = useState(0);         // tổng bản ghi khớp lọc (từ BE)
  const [counts, setCounts] = useState<Record<string, number>>({}); // số theo trạng thái → badge tab
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<TabId>("all");
  const [page, setPage] = useState(1);
  // Kỳ (Ngày yêu cầu / Ngày cần / Ngày duyệt) + Phòng ban, Người yêu cầu, Kho — lọc ở máy chủ.
  const [locMan, setLocManGoc] = useLocMan(MAN_YEU_CAU_KHO, LOC_MAN_YCK_TRONG, docLocManYCK, ghiLocManYCK);
  const setLocMan = (t: LocManYCK) => {
    setLocManGoc(t);
    setPage(1);
  };
  const dieuKien = useDieuKienYeuCauKho(dieuChuyen);
  // Nhập và Xuất chung một bảng; đang lọc đúng một chiều thì "Tạo yêu cầu" mở sẵn chiều đó.
  const loai = locMan.loc.loai;
  const khoaLoc = JSON.stringify({ ...thamSoKy(locMan.ky), ...thamSoLocYCK(locMan.loc, dieuChuyen) });
  const coLoc = locMan.ky.loai !== "tat_ca" || soDaAp(dieuKien, locMan.loc) > 0;
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  // null = đóng; "new" = soạn mới; {id} = mở yêu cầu đã có; {seed} = tạo lại từ yêu cầu cũ.
  const [drawer, setDrawer] = useState<
    | null
    | { mode: "new"; seed?: SeedLine[]; loai?: StockRequestKind; ghiChu?: string; ngayCan?: string; gioCan?: string; locked?: boolean; deliveryId?: number; donMuaMa?: string; dotSo?: number; nccTen?: string; hoaDon?: string }
    | { mode: "open"; id: number }
  >(null);
  // Phiếu kho mở từ ngăn yêu cầu (chồng lên trên).
  const [openVoucher, setOpenVoucher] = useState<number | null>(null);

  // Mở sẵn form TẠO khi được điều hướng kèm seed (bấm "Nhập kho" ở đợt giao đơn mua). Tiêu thụ
  // một lần: báo cha xoá seed để lần remount sau (đổi chiều Nhập/Xuất) không tự bật lại form.
  useEffect(() => {
    if (initialSeed?.seed?.length) {
      setDrawer({
        mode: "new",
        seed: initialSeed.seed,
        loai: "NHAP",
        ghiChu: initialSeed.ghi_chu,
        ngayCan: initialSeed.ngay_can,
        locked: initialSeed.locked,
        deliveryId: initialSeed.deliveryId,
        donMuaMa: initialSeed.don_mua_ma,
        dotSo: initialSeed.dot_so,
        nccTen: initialSeed.ncc_ten,
        hoaDon: initialSeed.hoa_don,
      });
      onSeedConsumed?.();
    }
  }, [initialSeed, onSeedConsumed]);

  const load = useCallback(() => {
    if (!token) return;
    setLoading(true);
    // BE-paging: tải ĐÚNG trang theo tab + kỳ + điều kiện; đếm số theo trạng thái riêng (cùng lọc).
    // Sắp theo 'id' (mới TẠO lên đầu) — yêu cầu vừa tạo hiện trên cùng.
    const filters = {
      q: q || null,
      dieu_chuyen: dieuChuyen,
      loc: JSON.parse(khoaLoc),
    };
    const tabStatuses = tab === "all" ? undefined : TAB_STATUSES[tab];
    Promise.all([
      api.kho.deNghi.list(token, { ...filters, trang_thai: tabStatuses, order: "id", page, size: pageSize }),
      api.kho.deNghi.tabCounts(token, filters),
    ])
      .then(([r, c]) => {
        setRows(r.items);
        setTotalCount(r.total);
        setCounts(c);
        setError(null);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Không tải được danh sách yêu cầu."))
      .finally(() => setLoading(false));
  }, [token, q, dieuChuyen, khoaLoc, tab, page, pageSize]);

  // Gõ tìm → chờ 300ms rồi mới gọi (mỗi lần gọi backend phải tính đèn tồn cho từng dòng).
  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [load]);

  // SSE đẩy tín hiệu đổi trạng thái → danh sách tự tươi, không bắt người dùng F5.
  useEffect(() => {
    if (eventTick > 0) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventTick]);

  // Bấm thông báo → mở sẵn drawer đúng yêu cầu + đánh dấu đã xem (là yêu cầu của người tạo) + hạ badge.
  useEffect(() => {
    if (openRequestId == null) return;
    setDrawer({ mode: "open", id: openRequestId });
    if (token) {
      api.kho.deNghi
        .markSeen(token, openRequestId)
        .then(() => onSeen?.())
        .catch(() => {});
    }
    onOpenRequestConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRequestId]);

  // Đang đứng ở màn này mà có phản hồi kho chưa xem (lúc mở màn, hoặc SSE vừa đẩy tới) ⇒ coi như đã
  // xem hết: bản ghi đã hiện trên danh sách, không bắt bấm mở từng cái mới tắt chấm.
  useEffect(() => {
    if (!token || unseenDone + unseenFail === 0) return;
    api.kho.deNghi.seenAll(token).then(() => onSeen?.()).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, unseenDone, unseenFail]);

  const meId = user?.id ?? -1;

  // Mở xem 1 yêu cầu. Nếu là phản hồi cuối (Hoàn tất / Không thành) thì đánh dấu ĐÃ XEM (per-request)
  // rồi refetch badge/số đỏ — "bấm xem cái nào mất cái đó".
  function openRequest(r: StockRequest) {
    setDrawer({ mode: "open", id: r.id });
    const terminal =
      r.trang_thai === "done" || r.trang_thai === "rejected" || r.trang_thai === "cancelled";
    if (token && terminal) {
      api.kho.deNghi
        .markSeen(token, r.id)
        .then(() => onSeen?.())
        .catch(() => {});
    }
  }

  // Số trên tab = CỘNG số theo trạng thái (BE trả `counts`); tab "Tất cả" = tổng mọi trạng thái.
  function countOf(id: TabId): number {
    if (id === "all") return Object.values(counts).reduce((s, n) => s + n, 0);
    return TAB_STATUSES[id].reduce((s, st) => s + (counts[st] ?? 0), 0);
  }

  // BE đã lọc (tab + 2 khoảng ngày + q) + phân trang + sắp 'updated' desc (khớp sortRequests)
  // → dùng thẳng danh sách trả về làm trang hiện tại.
  const total = totalCount;
  const shown = rows;

  useEffect(() => {
    setPage(1);
  }, [tab, q, khoaLoc, pageSize]);

  const tabs: { id: TabId; label: string }[] = [
    { id: "all", label: "Tất cả" },
    { id: "dang-cap", label: "Đang cấp" },
    { id: "done", label: "Hoàn tất" },
    { id: "khong-thanh", label: "Đã hủy" },
  ];
  // Trạng thái trong nút Lọc = chính dải chip (đọc/ghi `tab`), không đẻ state thứ hai.
  const dkDu: DieuKien<LocYeuCauKho>[] = [
    dkTheoTab<LocYeuCauKho>({
      tabs: tabs.map((t) => ({ id: t.id, nhan: t.label, so: countOf(t.id) })),
      tatCa: "all", dang: tab, dat: (id) => setTab(id as TabId),
    }),
    ...dieuKien,
  ];

  // Yêu cầu KHÔNG gắn kho nên không có tồn để soi → không có cột đèn. Cột "Người yêu cầu" cho thấy
  // AI xin ngay trên bảng; Bộ phận của người đó là cột riêng ở cuối (ẩn được qua nút Cột).
  const cotHien = luoi.rongHien(
    luoi
      .xep(COT_YC)
      .filter((c) => !luoi.an.has(c.key))
      .map((c) => (c.key === "can" ? { ...c, label: loai === "NHAP" ? "Cần nhập lúc" : "Cần lúc" } : c)),
  );
  const muc = tabs.map((t) => ({ key: t.id, label: t.label, count: countOf(t.id), mau: MAU_TAB_YC[t.id] }));
  const khongLoc = !coLoc && !q && tab === "all";
  const nutTao = canRequest && !dieuChuyen ? (
    <Button variant="accent" onClick={() => setDrawer({ mode: "new", loai })}>
      <PlusIcon /> Tạo yêu cầu
    </Button>
  ) : null;

  return (
    <>
      {/* Tên màn + nút chính nằm ở đầu trang chung của KhoPage; nút vẽ vào chỗ đó bằng portal. */}
      {slotNut && nutTao ? createPortal(nutTao, slotNut) : null}

      <section className="lds-loc">
        <LocNhanhTrangThai muc={muc} dang={tab} onChon={(k) => setTab(k as TabId)} />
        <div className="lds-loc__thanh tl-thanh" role="search">
          <OTim value={q} onChange={setQ} placeholder="Tìm mã yêu cầu, vật tư" ariaLabel="Tìm yêu cầu nhập xuất" />
          <ThanhLoc
            ky={locMan.ky}
            moc={MOC_YEU_CAU_KHO}
            onKy={(ky) => setLocMan({ ...locMan, ky })}
            dieuKien={dkDu}
            loc={locMan.loc}
            onLoc={(loc) => setLocMan({ ...locMan, loc })}
          />
          <ChonCot cot={COT_YC} {...luoi.chonCot} />
        </div>
      </section>

      <div className="lds-sheet">
        <CuonLuoi ghim={luoi.soGhim(cotHien)}>
          <table className="lds-g" style={{ minWidth: rongLuoi(cotHien) }}>
            <colgroup>
              {cotHien.map((c) => <col key={c.key} style={c.w ? { width: c.w } : undefined} />)}
            </colgroup>
            <thead>
              <tr>
                {cotHien.map((c) => (
                  <th key={c.key}>
                    {c.label}
                    {luoi.keo(c.key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && shown.length === 0 ? (
                <EmptyRow colSpan={cotHien.length} trangThai="dang-tai" />
              ) : error ? (
                <tr>
                  <td colSpan={cotHien.length} className="lds-trong">
                    <span className="lds-do">{error}</span>{" "}
                    <button type="button" className="lds-lk" onClick={load}>Thử lại</button>
                  </td>
                </tr>
              ) : shown.length === 0 ? (
                <tr>
                  <td colSpan={cotHien.length} className="lds-trong">
                    {khongLoc
                      ? dieuChuyen
                        ? "Chưa có điều chuyển nào. Tạo điều chuyển ở màn Tồn kho (nút “Chuyển kho”)."
                        : "Chưa có yêu cầu nào. Tạo yêu cầu để xin nhập hoặc lĩnh vật tư."
                      : "Không có yêu cầu nào khớp điều kiện đang lọc."}{" "}
                    {khongLoc ? (
                      nutTao && (
                        <button type="button" className="lds-lk" onClick={() => setDrawer({ mode: "new", loai })}>
                          Tạo yêu cầu
                        </button>
                      )
                    ) : (
                      <button
                        type="button"
                        className="lds-lk"
                        onClick={() => {
                          setQ("");
                          setTab("all");
                          setLocMan(LOC_MAN_YCK_TRONG);
                        }}
                      >
                        Xoá bộ lọc
                      </button>
                    )}
                  </td>
                </tr>
              ) : (
                shown.map((r) => (
                  <tr
                    key={r.id}
                    className={`lds-dong${drawer?.mode === "open" && drawer.id === r.id ? " is-chon" : ""}`}
                    tabIndex={0}
                    onClick={() => openRequest(r)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        openRequest(r);
                      }
                    }}
                  >
                    {cotHien.map((c) => <OYeuCau key={c.key} cot={c.key} r={r} />)}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CuonLuoi>
        {/* Về trang 1 ngay trong cùng lượt đổi cỡ — khỏi một lượt nạp thừa (trang cũ × cỡ mới) trước
            khi effect reset kịp chạy. */}
        {!error && total > 0 && (
          <PhanTrangDayDu trang={page} size={pageSize} tong={total} soDong={shown.length}
            onTrang={setPage} onSize={(n) => { setPageSize(n); setPage(1); }} loading={loading} donVi="yêu cầu"
            ariaLabel="Phân trang yêu cầu nhập xuất" />
        )}
      </div>

      {drawer?.mode === "open" && token && (
        // Xem yêu cầu ĐÃ GỬI: cùng ngăn khuôn A với bên kho, chỉ khác nút ở đầu ngăn theo vai. Tồn chỉ
        // hiện khi người xem có quyền xem tồn đúng kho đó (máy chủ cũng gate), giá theo `view_cost`.
        <InboxRequestDrawer
          key={`req-${drawer.id}`}
          token={token}
          khoId={null}
          requestId={drawer.id}
          canCreate={false}
          canViewStock={false}
          canViewCost={can("kho", "view_cost")}
          onClose={() => setDrawer(null)}
          onCreateVoucher={() => {}}
          onOpenVoucher={setOpenVoucher}
          thaoTac={(r) =>
            // Bị từ chối / đã hủy: chủ yêu cầu tạo lại nhanh từ chính các dòng cũ. Điều chuyển KHÔNG tạo
            // lại ở đây — điều chuyển chỉ sinh từ màn Tồn kho (nút "Chuyển kho").
            (r.trang_thai === "rejected" || r.trang_thai === "cancelled") && r.nguoi_tao_id === meId
              && canRequest && !r.dieu_chuyen ? (
              <button type="button" className="kna-nut kna-nut--chinh"
                onClick={() => setDrawer({
                  mode: "new", seed: r.lines.map(seedTuDong), loai: r.loai,
                  // Giữ thói quen giờ cần của yêu cầu cũ; ngày thì chọn lại (ngày cũ thường đã qua).
                  gioCan: r.can_luc?.slice(11, 16) || undefined,
                })}>
                Tạo lại từ yêu cầu này
              </button>
            ) : null
          }
        />
      )}

      {/* Người TẠO xem phiếu đã cấp — cùng ngăn phiếu như bên kho, chỉ đọc. Giá theo `view_cost`. */}
      {openVoucher != null && token && (
        <VoucherDrawer
          key={`v-${openVoucher}`}
          token={token}
          voucherId={openVoucher}
          canCreate={false}
          canPost={false}
          canViewCost={can("kho", "view_cost")}
          onClose={() => setOpenVoucher(null)}
          onChanged={() => {}}
          tang={1}
        />
      )}

      {drawer?.mode === "new" && token && (
        <TaoYeuCauP2
          key="req-new"
          token={token}
          seed={drawer.seed}
          seedLoai={drawer.loai}
          seedGhiChu={drawer.ghiChu}
          seedNgayCan={drawer.ngayCan}
          seedGioCan={drawer.gioCan}
          seedLocked={drawer.locked}
          seedDeliveryId={drawer.deliveryId}
          seedDonMuaMa={drawer.donMuaMa}
          seedDotSo={drawer.dotSo}
          seedNccTen={drawer.nccTen}
          seedHoaDon={drawer.hoaDon}
          canRequest={canRequest}
          onClose={() => setDrawer(null)}
          onSaved={() => {
            setDrawer(null);
            // Về trang 1 để yêu cầu VỪA TẠO (mới nhất, trên cùng vì order=id desc) chắc chắn hiện;
            // refetch ngay tại chỗ, KHÔNG reload cả trang.
            setPage(1);
            load();
          }}
        />
      )}
    </>
  );
}

// ── Lưới danh sách (khuôn chung 08/10/2026) ──────────────────────────────────
// Thứ tự: Mã, Ngày tạo, Loại, Vật tư, Nguồn, Tiến độ, Cần lúc, Trạng thái, Người yêu cầu, Bộ phận.
interface CotYC extends CotLuoi { w?: number }
const COT_YC: CotYC[] = [
  { key: "ma", label: "Mã yêu cầu", coDinh: true, w: 120 },
  { key: "ngay", label: "Ngày tạo", w: 104 },
  { key: "loai", label: "Loại", w: 104 },
  { key: "vattu", label: "Vật tư", w: 250 },
  { key: "nguon", label: "Nguồn", w: 180 },
  { key: "tiendo", label: "Tiến độ", w: 170 },
  { key: "can", label: "Cần lúc", w: 140 },
  { key: "tt", label: "Trạng thái", w: 150 },
  { key: "nguoi", label: "Người yêu cầu", w: 150 },
  { key: "bophan", label: "Bộ phận" },
];

/** Chấm màu của hàng lọc nhanh (theo nhóm trạng thái). */
const MAU_TAB_YC: Record<TabId, MauTT | undefined> = {
  all: undefined,
  "dang-cap": "cam",
  done: "la",
  "khong-thanh": "xam",
};

/** Mỗi trạng thái một sắc, không trùng nhau. */
const MAU_TT_YC: Record<string, MauTT> = {
  draft: "slate",
  pending: "vang",
  approved: "xanh",
  received: "cyan",
  preparing: "tim",
  partial: "cam",
  done: "la",
  rejected: "do",
  cancelled: "xam",
};

/** Chip loại yêu cầu (chip khâu, góc vuông). */
function chipLoai(r: StockRequest): { mau: MauTT; nhan: string } {
  if (r.dieu_chuyen) return { mau: "slate", nhan: "Điều chuyển" };
  return r.loai === "NHAP" ? { mau: "ngoc", nhan: "Nhập" } : { mau: "cham", nhan: "Xuất" };
}

function OYeuCau({ cot, r }: { cot: string; r: StockRequest }) {
  switch (cot) {
    case "ma":
      return <td title={r.ma}>{r.ma}</td>;
    case "ngay":
      return <td title={fmtDateTime(r.created_at)}>{fmtDate(r.created_at)}</td>;
    case "loai": {
      const l = chipLoai(r);
      return <td><ChipTT mau={l.mau} vuong>{l.nhan}</ChipTT></td>;
    }
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
      return <td><NguonA r={r} /></td>;
    case "tiendo":
      return <td><TienDoA r={r} /></td>;
    case "can": {
      const canLuc = canLucCua(r);
      const quaHan = isOverdue(r.ngay_can, r.trang_thai, r.can_luc);
      if (!canLuc) return <td className="lds-mu">Chưa hẹn</td>;
      return <td className={quaHan ? "lds-do" : undefined} title={quaHan ? "Quá hạn" : undefined}>{canLuc}</td>;
    }
    case "tt": {
      const nhan = r.trang_thai === "partial" && r.loai === "NHAP"
        ? "Đã nhập một phần"
        : (REQUEST_STATUS[r.trang_thai]?.label ?? r.trang_thai);
      return <td><ChipTT mau={MAU_TT_YC[r.trang_thai] ?? "slate"}>{nhan}</ChipTT></td>;
    }
    case "nguoi":
      return <td title={r.nguoi_tao_ten ?? undefined}>{r.nguoi_tao_ten ?? "—"}</td>;
    case "bophan":
      return r.bo_phan_ten ? <td title={r.bo_phan_ten}>{r.bo_phan_ten}</td> : <td className="lds-mu">—</td>;
    default:
      return <td />;
  }
}

// ── Ô "Cho lệnh nào" (mg 0175) ───────────────────────────────────────────────
// MỘT ô cho cả lệnh lẫn bài ghép: người yêu cầu không nghĩ theo hai khái niệm, họ nghĩ "đợt hàng
// này". Giá trị mã hoá `lsx:<id>` / `bg:<id>` rồi tách ra lúc gửi, nên payload vẫn là hai cột rõ ràng.

interface LenhOption {
  kind: "lsx" | "bai_ghep";
  id: number;
  ma: string;
  ten: string;
}

/** Nhãn chỉ-đọc của ô "Cho lệnh". Đọc thẳng `lsx_ma`/`bai_ghep_ma` server GỬI KÈM từng dòng
 *  (`schemas/stock.py`), không tra trong một danh sách đã tải — danh sách ấy vốn không thể chứa
 *  hết 100.000 lệnh, và tra hụt thì nhãn tụt xuống "Lệnh #123" dù lệnh vẫn sống. */
function lenhNhan(l: { lsx_id?: number | null; bai_ghep_id?: number | null;
                       lsx_ma?: string | null; bai_ghep_ma?: string | null }): string {
  if (l.lsx_ma) return l.lsx_ma;
  if (l.bai_ghep_ma) return l.bai_ghep_ma;
  // Có id mà server chưa kịp gửi mã (dòng vừa chọn tại chỗ) — vẫn phải hiện, đừng nuốt mất.
  if (l.lsx_id) return `Lệnh #${l.lsx_id}`;
  if (l.bai_ghep_id) return `Bài #${l.bai_ghep_id}`;
  return "—";
}

/** Ô CHỌN LỆNH — tìm-gõ hỏi máy chủ, dựng theo đúng khuôn `components/MaterialCombobox`.
 *
 *  Trước đây đây là một `<select>` nhồi TOÀN BỘ bảng `lsx`. Ở quy mô thật (100.000 lệnh) thì mở
 *  drawer là kéo cả bảng về chỉ để đổ vào một thẻ chọn không ai cuộn hết — nên ô này gõ tới đâu
 *  hỏi tới đó, `size: 20`.
 *
 *  Bài ghép vẫn lấy trọn (bảng nhỏ) rồi lọc tại chỗ, nhưng hiện CHUNG một danh sách: người dùng
 *  chỉ nghĩ "xin cho lệnh nào", không quan tâm nó là lệnh lẻ hay bài ghép. */
function LenhChon({
  token,
  lsxId,
  baiGhepId,
  nhan,
  onChange,
  autoFocus,
}: {
  token: string;
  lsxId: number | null;
  baiGhepId: number | null;
  /** Nhãn đang chọn (mã lệnh/bài) — hiện sẵn trong ô khi mở dòng đã lưu. */
  nhan: string;
  onChange: (lsxId: number | null, baiGhepId: number | null, ma: string | null) => void;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState(nhan);
  const [opts, setOpts] = useState<LenhOption[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setText(nhan), [nhan]);

  useEffect(() => {
    if (!open) return;
    let huy = false;
    const t = setTimeout(() => {
      const tim = text.trim();
      void Promise.all([
        api.lsx.list(token, { q: tim || undefined, size: 20 }),
        api.baiGhep2.list(token),
      ])
        .then(([ls, bg]) => {
          if (huy) return;
          const loc = tim.toLowerCase();
          setOpts([
            ...ls.items.map((l) => ({ kind: "lsx" as const, id: l.id, ma: l.ma, ten: l.ten })),
            ...bg.items
              .filter((b) => !loc || b.ma.toLowerCase().includes(loc))
              .slice(0, 20)
              .map((b) => ({ kind: "bai_ghep" as const, id: b.id, ma: b.ma, ten: "" })),
          ]);
          setActive(0);
        })
        // Không tra được lệnh KHÔNG được chặn việc lập yêu cầu — ô này vốn bỏ trống được.
        .catch(() => {
          if (!huy) setOpts([]);
        });
    }, 200);
    return () => {
      huy = true;
      clearTimeout(t);
    };
  }, [text, open, token]);

  function doViTri() {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setRect({ top: r.bottom + 4, left: r.left, width: Math.max(r.width, 320) });
  }

  useLayoutEffect(() => {
    if (open) doViTri();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    window.addEventListener("resize", doViTri);
    window.addEventListener("scroll", doViTri, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", doViTri);
      window.removeEventListener("scroll", doViTri, true);
    };
  }, [open]);

  /** `null` = dòng "Không theo lệnh" (xin lặt vặt — băng dính, giẻ lau). */
  function chon(o: LenhOption | null) {
    setText(o?.ma ?? "");
    setOpen(false);
    if (!o) onChange(null, null, null);
    else if (o.kind === "lsx") onChange(o.id, null, o.ma);
    else onChange(null, o.id, o.ma);
  }

  const list = (
    <ul
      className="kho-combo__list"
      role="listbox"
      style={rect ? { top: rect.top, left: rect.left, width: rect.width } : undefined}
    >
      <li
        role="option"
        aria-selected={active === 0}
        className={`kho-combo__opt${active === 0 ? " is-active" : ""}`}
        onMouseEnter={() => setActive(0)}
        onMouseDown={(e) => {
          e.preventDefault();
          chon(null);
        }}
      >
        <span className="kho-combo__name">— Không theo lệnh —</span>
      </li>
      {opts.map((o, i) => (
        <li
          key={`${o.kind}:${o.id}`}
          role="option"
          aria-selected={i + 1 === active}
          className={`kho-combo__opt${i + 1 === active ? " is-active" : ""}`}
          onMouseEnter={() => setActive(i + 1)}
          onMouseDown={(e) => {
            e.preventDefault();
            chon(o);
          }}
        >
          <span className="kho-combo__name">
            {o.ten || "—"}
            <span className="kho-combo__nhom">{o.kind === "lsx" ? "Lệnh" : "Bài ghép"}</span>
          </span>
          <span className="kho-combo__code">{o.ma}</span>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="kho-combo" ref={rootRef} style={{ minWidth: 156 }}>
      <input
        ref={inputRef}
        className="rc-input kho-combo__input"
        value={text}
        placeholder="Không theo lệnh"
        aria-label="Xin cho lệnh sản xuất nào (bỏ trống nếu xin lặt vặt)"
        autoComplete="off"
        autoFocus={autoFocus}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          // Xoá trắng ô = bỏ gắn lệnh. Gõ dở rồi bỏ đi thì trả về nhãn cũ, không tự đoán.
          if (!text.trim() && (lsxId || baiGhepId)) chon(null);
          else if (text.trim() !== nhan) setText(nhan);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(a + 1, opts.length));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter") {
            if (!open) return;
            e.preventDefault();
            chon(active === 0 ? null : opts[active - 1]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {open && createPortal(list, document.body)}
    </div>
  );
}

/** Lệnh của MỘT DÒNG trong form P2 (mockup: thẻ nhỏ dưới tên vật tư). Chưa gắn lệnh thì chỉ là chữ
 *  mờ "Không theo lệnh"; bấm vào mới mở ô tìm lệnh, chọn xong hoặc rời ô là thu về thẻ. Vẽ sẵn ô có
 *  viền ở mọi dòng thì trông như ô bắt buộc phải điền (user phản ánh 07/10/2026). */
function LenhDong({
  token,
  lsxId,
  baiGhepId,
  nhan,
  onChange,
}: {
  token: string;
  lsxId: number | null;
  baiGhepId: number | null;
  nhan: string;
  onChange: (lsxId: number | null, baiGhepId: number | null, ma: string | null) => void;
}) {
  const [sua, setSua] = useState(false);
  if (sua) {
    return (
      <span className="tyc-lenh" onBlur={() => setSua(false)}>
        <LenhChon
          token={token}
          lsxId={lsxId}
          baiGhepId={baiGhepId}
          nhan={nhan}
          autoFocus
          onChange={(a, b, ma) => {
            onChange(a, b, ma);
            setSua(false);
          }}
        />
      </span>
    );
  }
  return (
    <button
      type="button"
      className={nhan ? "kna-tag tyc-lenh-the" : "tyc-lenh-the tyc-lenh-the--rong"}
      title={nhan ? "Đổi lệnh của dòng này" : "Gắn dòng này cho một lệnh sản xuất"}
      onClick={() => setSua(true)}
    >
      {nhan || "Không theo lệnh"}
    </button>
  );
}

// ── DRAWER ────────────────────────────────────────────────────────────────────

export interface SeedLine {
  /** MẶT HÀNG GỐC — null = dòng trống chưa chọn. Không còn khái niệm "hàng chưa có mã". */
  hang_loai: HangLoai | null;
  hang_id: number | null;
  hang_ma: string | null;
  hang_ten: string | null;
  /** Đơn vị người yêu cầu chọn (trong tập đổi được của mặt hàng) + hệ số về đơn vị gốc để
   *  hiện trước con số sẽ vào tồn. */
  dvt: string;
  he_so_ve_goc: number | null;
  sl_de_nghi: number;
  /** Đơn giá NHẬP người yêu cầu khai (chỉ yêu cầu NHẬP), theo `dvt`. Phiếu kế thừa; kho không sửa. */
  don_gia: number | null;
  /** XIN CHO LỆNH NÀO (mg 0175). Bỏ trống được — xin lặt vặt (băng dính, giẻ lau) không thuộc lệnh
   *  nào. Khai rồi thì bảng cân đối vật tư của Kế hoạch trừ phần đã cấp vào ĐÚNG dòng nhu cầu. */
  lsx_id?: number | null;
  bai_ghep_id?: number | null;
  /** MÃ lệnh/bài server gửi kèm dòng — nhãn hiện tại chỗ, khỏi tra ngược một danh sách đã tải. */
  lsx_ma?: string | null;
  bai_ghep_ma?: string | null;
  /** GIẤY: khổ mm (rộng × dài; dài để trống = khổ chỉ rộng). Hàng khác để trống. */
  kho_rong?: number;
  kho_dai?: number;
  /** UI-only (KHÔNG gửi API — máy chủ tự suy từ `dvt`): mã đơn vị gốc của họ chứa `dvt` (`to`, `kg`…).
   *  Ô đơn vị báo lên; dùng để khớp tồn đúng dòng mã + khổ + đơn vị gốc. */
  don_vi_goc?: string | null;
  ghi_chu: string | null;
}

/** Gói dữ liệu điều hướng-kèm để mở sẵn form TẠO yêu cầu NHẬP đã điền — dùng khi bấm "Nhập kho"
 *  ở một đợt giao đơn mua (đợt giao ↔ phiếu nhập kho là CÙNG sự kiện hàng về). */
export interface KhoNhapSeed {
  seed: SeedLine[];
  /** Ghi chú cấp phiếu, thường trỏ về mã đơn mua + số đợt để truy vết. */
  ghi_chu?: string;
  /** Ngày nhập điền sẵn (yyyy-mm-dd) — lấy từ ngày giao của đợt. */
  ngay_can?: string;
  /** true = số liệu lấy từ đơn mua → KHOÁ, không cho sửa dòng (phải khớp hàng đã nhận). */
  locked?: boolean;
  /** Nguồn đợt giao (purchase_deliveries.id) → gắn vào yêu cầu để chặn nhập trùng đợt. */
  deliveryId?: number;
  /** Mã đơn mua (purchase_requests.code) + số đợt giao — hiện rõ nguồn ngay ở form nhập. */
  don_mua_ma?: string;
  dot_so?: number;
  /** Nhà cung cấp + số hoá đơn của đợt — thẻ Nguồn của form nhập (mockup P2). */
  ncc_ten?: string;
  hoa_don?: string;
}

export interface DraftLine extends SeedLine {
  key: string;
  /** id dòng đã lưu — cần để gửi `approved_qty`. */
  lineId: number | null;
  sl_duyet: number;
  sl_da_ung: number;
  /** Kho phản hồi: lý do cấp/nhập thiếu (chỉ đọc). */
  ly_do_thieu: string | null;
  /** Dòng thành phẩm KCS: giá gốc đọc từ lô + giá bán theo đơn (chỉ đọc, chỉ có khi `view_cost`). */
  tu_kcs: boolean;
  gia_goc: number | null;
  /** Σ giá × SL các đợt đã nhập — tổng giá trị dòng KCS, không nhân ngược `gia_goc` đã làm tròn. */
  tien_goc: number | null;
  don_gia_ban: number | null;
  don_ban_ma: string | null;
  /** Chỉ khi form mở từ công việc (`TuCongViec`): số nền cột thứ hai + cờ dòng kế hoạch. */
  sl_nen?: number | null;
  theo_ke_hoach?: boolean;
  /** Đơn vị của số nền — chốt lúc mở form, người xin đổi đơn vị ô số thì cột nền không đổi theo. */
  dvt_nen?: string;
  /** Khổ chỉ đọc mà dòng vẫn xoá được (dòng "Đã xin" của yêu cầu bổ sung). */
  kho_chi_doc?: boolean;
  /** Câu cam dưới tên khi dòng chưa có đơn vị tính — tắt ngay khi ô đơn vị có chữ. */
  canh?: string | null;
  /** UI-only: gsm của giấy (danh mục) — quy kg ra tờ cho giấy khổ hai cạnh (`gocDongXin`). */
  dinh_luong?: number | null;
}

let lineSeq = 0;
function newLine(seed?: Partial<SeedLine>): DraftLine {
  lineSeq += 1;
  return {
    key: `l${lineSeq}`,
    lineId: null,
    hang_loai: seed?.hang_loai ?? null,
    hang_id: seed?.hang_id ?? null,
    hang_ma: seed?.hang_ma ?? null,
    hang_ten: seed?.hang_ten ?? null,
    dvt: seed?.dvt ?? "",
    he_so_ve_goc: seed?.he_so_ve_goc ?? null,
    sl_de_nghi: seed?.sl_de_nghi ?? 0,
    don_gia: seed?.don_gia ?? null,
    lsx_id: seed?.lsx_id ?? null,
    bai_ghep_id: seed?.bai_ghep_id ?? null,
    lsx_ma: seed?.lsx_ma ?? null,
    bai_ghep_ma: seed?.bai_ghep_ma ?? null,
    don_vi_goc: seed?.don_vi_goc ?? null,
    kho_rong: seed?.kho_rong ?? 0,
    kho_dai: seed?.kho_dai ?? 0,
    ghi_chu: seed?.ghi_chu ?? null,
    sl_duyet: 0,
    sl_da_ung: 0,
    ly_do_thieu: null,
    tu_kcs: false,
    gia_goc: null,
    tien_goc: null,
    don_gia_ban: null,
    don_ban_ma: null,
  };
}

/** Dòng của yêu cầu đã gửi → dòng mồi cho "Tạo lại từ yêu cầu này". */
function seedTuDong(l: StockRequestLine): SeedLine {
  return {
    hang_loai: l.hang_loai,
    hang_id: l.hang_id,
    hang_ma: l.hang_ma,
    hang_ten: l.hang_ten,
    kho_rong: l.kho_rong,
    kho_dai: l.kho_dai,
    dvt: l.dvt,
    // Suy ngược từ số server đã quy đổi — khỏi gọi thêm API chỉ để lấy hệ số.
    he_so_ve_goc: l.sl_quy_doi && l.sl_de_nghi ? l.sl_quy_doi / l.sl_de_nghi : null,
    sl_de_nghi: l.sl_de_nghi,
    don_gia: l.don_gia,
    ghi_chu: l.ghi_chu,
  };
}

interface RequestDrawerProps {
  token: string;
  meId: number;
  requestId: number | null;
  seed?: SeedLine[];
  seedLoai?: StockRequestKind;
  seedGhiChu?: string;
  seedNgayCan?: string;
  /** Giờ cần "HH:mm" điền sẵn (tạo lại từ yêu cầu có `can_luc`). */
  seedGioCan?: string;
  seedLocked?: boolean;
  seedDeliveryId?: number;
  seedDonMuaMa?: string;
  seedDotSo?: number;
  seedNccTen?: string;
  seedHoaDon?: string;
  canRequest: boolean;
  onClone: (lines: SeedLine[], loai: StockRequestKind) => void;
  onClose: () => void;
  onSaved: () => void;
}

// ── FORM TẠO YÊU CẦU — phương án P2 (docs/mockups/yeu-cau-nhap-xuat-3-phuong-an.html, chốt 07/10/2026)
//
// Khuôn "Create transfer" của Shopify, cùng khuôn form mua hàng phương án A: bảng vật tư bên trái
// (Vật tư, Tồn, Số lượng xin), cột thuộc tính bên phải (Loại, Ngày cần + chọn nhanh, Lệnh sản xuất
// cho dòng mới, Ghi chú). Đơn vị là chữ trong ô số lượng; chân form đếm MẶT HÀNG, không cộng số
// khác đơn vị. Mở từ đợt giao (Nhập kho): chiều Nhập cố định, dòng + số lượng khoá, có thẻ Nguồn.
// Ngăn XEM yêu cầu đã gửi là `InboxRequestDrawer` (KhoYeuCauPage).

/** Tồn toàn xưởng của dòng theo ĐÚNG khoá mã + khổ (giấy) + đơn vị gốc, theo đơn vị gốc. `null` =
 *  chưa biết (chưa chọn hàng / giấy chưa có khổ / chưa rõ đơn vị gốc / chưa nạp xong). Khổ chỉ rộng
 *  KHÔNG khớp khổ hai cạnh; hai đơn vị khai riêng (tờ và kg, kg và thùng) không cộng lẫn nhau. */
function tonCuaDong(l: DraftLine, rows: TonKhoaRow[] | undefined): number | null {
  if (!rows || !l.hang_id) return null;
  if (!coDonViGoc(l.hang_loai)) return rows.reduce((s, r) => s + r.ton, 0);
  const laGiay = l.hang_loai === "giay";
  const [r, d] = coKho(l.hang_loai) ? chuanKho(l.kho_rong, l.kho_dai) : [0, 0];
  // Vật tư khổ tuỳ chọn (27/10/2026): có khổ thì đúng khổ, trống khổ thì cộng mọi khổ (luật máy chủ).
  const theoKho = laGiay || r > 0;
  // Ô đơn vị chưa báo đơn vị gốc (dòng khoá không vẽ ô chọn) ⇒ thử chính `dvt`: đang là đơn vị gốc
  // (tờ, kg) thì khớp, là đơn vị quy đổi (ram) thì không khớp dòng nào ⇒ coi như chưa biết.
  if (laGiay && !r) return null;
  if (rows.length === 0) return 0; // mã này chưa tồn ở đâu: khổ nào, đơn vị nào cũng là 0
  const goc0 = l.don_vi_goc || (rows.some((x) => x.don_vi_goc === l.dvt) ? l.dvt : null);
  if (!goc0) return null;
  // Giấy khổ hai cạnh xin theo kg: lô đếm tờ.
  const goc = gocDongXin({ hangLoai: l.hang_loai, donViGoc: goc0, rong: r, dai: d, slGoc: 0, gsm: null }).goc;
  return rows.filter((x) => (!theoKho || (x.kho_rong === r && x.kho_dai === d)) && x.don_vi_goc === goc)
    .reduce((s, x) => s + x.ton, 0);
}

const CHON_NGAY: { nhan: string; ngay: number }[] = [
  { nhan: "Hôm nay", ngay: 0 },
  { nhan: "Mai", ngay: 1 },
  { nhan: "+3 ngày", ngay: 3 },
];

function cachHomNay(n: number): string {
  return congNgay(todayISO(), n);
}

/** Ngày "yyyy-mm-dd" + giờ "HH:mm" → giờ tường "yyyy-mm-ddTHH:mm:00" gửi `can_luc`. Thiếu ngày hoặc
 *  thiếu giờ ⇒ null: máy chủ chỉ lưu ngày (`ngay_can`), không tự đoán giờ. */
export function ghepCanLuc(ngay: string, gio: string): string | null {
  if (!ngay || !gio) return null;
  return `${ngay}T${gio.slice(0, 5)}:00`;
}

/** Dòng nạp sẵn khi form mở từ công việc của bàn tổ. */
export interface DongTuCongViec extends SeedLine {
  /** Số nền hiện ở cột thứ hai: kế hoạch (moi/sua) hoặc đã xin (bo_sung). null = dòng ngoài kế hoạch ("—"). */
  sl_nen: number | null;
  /** Dòng theo kế hoạch: không xoá được, khổ chỉ đọc, có nút "Về 0". */
  theo_ke_hoach: boolean;
  /** Khổ chỉ đọc nhưng vẫn xoá được (dòng "Đã xin" của yêu cầu bổ sung). */
  kho_chi_doc?: boolean;
  /** Đơn vị của `sl_nen` khi khác `dvt` (tổ từng xin bằng đơn vị khác kế hoạch); thiếu = `dvt`. */
  dvt_nen?: string;
  /** Câu cam hiện dưới tên vật tư khi dòng chưa có đơn vị tính (ẩn ngay khi ô đơn vị có chữ). */
  canh?: string | null;
}

/** Form Kho MỞ TỪ CÔNG VIỆC (tab Vật tư của bàn tổ, mockup ban-to-hop-thoai-B #vat-tu): chiều Nhập/Xuất
 *  đã biết theo nút bấm nên ẩn, lệnh khoá theo việc, có cột nền Kế hoạch / Đã xin, giờ cần bắt buộc,
 *  gửi qua `onGui` (đường của tổ) thay cho `api.kho.deNghi.create`. */
export interface TuCongViec {
  duongDan: string;               // "Bàn tổ Cắt 2 › Cắt tờ của LSX26-0004 › Tạo mới"
  tieuDe: string;                 // "Yêu cầu xuất kho" | "Sửa yêu cầu xuất kho YC26-0031" | "Yêu cầu nhập kho"
  loai: StockRequestKind;         // XUAT cho moi/bo_sung/sua, NHAP cho nhap_lai — seg Nhập/Xuất ẨN
  cotNen: string | null;          // "Kế hoạch" | "Đã xin" | null (nhập lại không có cột nền)
  nhanSoLuong: string;            // "Số lượng xin" | "Số xin thêm" | "Số lượng nhập"
  nutGui: string;                 // "Gửi kho" | "Lưu thay đổi"
  lenh: { ma: string; ten: string; congDoan: string; to: string; lan?: { so: number; nguoi: string; luc: string } | null };
  canLuc: string;                 // "yyyy-mm-ddTHH:mm" giá trị đầu
  lucBatDauViec: string | null;   // chip "Lúc bắt đầu việc" (chỉ XUAT) đặt ngày+giờ về mốc này
  goiY: string | null;            // câu xám dưới ô Thêm vật tư
  dong: DongTuCongViec[];
  ghiChu: string;
  /** Cho gửi khi không còn dòng nào (sửa đưa hết về 0 = tự huỷ yêu cầu, spec §5.3): `dong` đi rỗng. */
  choPhepRong?: boolean;
  /** Đơn vị gợi ý cho dòng THÊM TAY (hàng khác giấy) — đơn vị lần trước của chính mặt hàng đó. null =
   *  không có gợi ý, ô đơn vị tự điền đơn vị gốc như thường. */
  dvtGoiY?: (hangLoai: HangLoai, hangId: number) => string | null;
  onGui: (p: { can_luc: string; ghi_chu: string | null; dong: DraftLine[] }) => Promise<void>;
}

/** "2026-10-09T10:05" → "09/10 10:05" (mốc lần đề nghị trong thẻ lệnh). */
function ngayGioNgan(luc: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(luc);
  return m ? `${m[3]}/${m[2]} ${m[4]}:${m[5]}` : luc;
}

/** Khoá khay điện thoại không phải dòng vật tư (key dòng là `l1`, `l2`… nên không trùng). */
const K_LUC = "@luc";
const K_GHI = "@ghi";
const K_LENH = "@lenh";

/** Khay trồi từ đáy của form trên điện thoại (mockup ban-to-hop-thoai-B `#vtPhone`, `.dt-phu > .dt-khay`).
 *  Chạm nền hoặc Esc thì đóng; Esc không lọt ra ngăn (ngăn chỉ đóng khi khay đã đóng). Đặt ngoài
 *  `TaoYeuCauP2` để mỗi lần form vẽ lại khay không bị dựng mới — ô số đang gõ khỏi mất con trỏ.
 *  Portal ra `body`: thân ngăn có `container-type` nên `position: fixed` bên trong bị neo vào thân
 *  (cuộn theo, không che chân ngăn). */
function KhayDuoi({ tieuDe, phu, onDong, children }: {
  tieuDe: string;
  phu?: ReactNode;
  onDong: () => void;
  children: ReactNode;
}) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Mở: tiêu điểm vào ô chính (ô số / ghi chú) — chạm dòng là gõ được ngay. Đóng: trả về dòng vừa chạm.
    const truoc = document.activeElement;
    const khay = ref.current;
    const o = khay?.querySelector<HTMLElement>("[data-tu-chon]");
    (o ?? khay)?.focus({ preventScroll: true });
    return () => {
      if (truoc instanceof HTMLElement && truoc.isConnected) truoc.focus({ preventScroll: true });
    };
  }, []);
  return createPortal(
    <div className="kfd-phu" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) onDong(); }}>
      <div ref={ref} className="kfd-khay" role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === "Tab" && ref.current) {
            // Bẫy tiêu điểm: Tab / Shift+Tab xoay vòng trong khay (aria-modal), không lọt ra ngăn phía sau.
            const o = [...ref.current.querySelectorAll<HTMLElement>(
              'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
            )].filter((x) => !x.closest("[hidden]"));
            if (!o.length) { e.preventDefault(); return; }
            const dau = o[0];
            const cuoi = o[o.length - 1];
            const dang = document.activeElement;
            if (e.shiftKey && (dang === dau || dang === ref.current || !ref.current.contains(dang))) {
              e.preventDefault();
              cuoi.focus();
            } else if (!e.shiftKey && (dang === cuoi || !ref.current.contains(dang))) {
              e.preventDefault();
              dau.focus();
            }
            return;
          }
          if (e.key !== "Escape" || e.defaultPrevented) return;
          // Danh sách gợi ý (đơn vị, khổ, lệnh) đang xổ thì Esc là của nó.
          const o = document.activeElement;
          if (o instanceof HTMLElement && o.closest('[aria-expanded="true"], [role="listbox"]')) return;
          e.preventDefault();
          e.stopPropagation();
          onDong();
        }}>
        <div className="kfd-grip" aria-hidden="true" />
        <div id={id} className="kfd-khay__t">{tieuDe}</div>
        {phu}
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function TaoYeuCauP2({
  token,
  tuCongViec,
  seed,
  seedLoai,
  seedGhiChu,
  seedNgayCan,
  seedGioCan,
  seedLocked,
  seedDeliveryId,
  seedDonMuaMa,
  seedDotSo,
  seedNccTen,
  seedHoaDon,
  canRequest,
  onClose,
  onSaved,
}: Omit<RequestDrawerProps, "meId" | "requestId" | "onClone"> & {
  /** Có = mở từ công việc của bàn tổ (xem `TuCongViec`); không = form Kho như cũ. */
  tuCongViec?: TuCongViec;
}) {
  useNapTenDonVi();
  const can = useCan();
  const canViewCost = can("kho", "view_cost");
  const cv = tuCongViec ?? null;
  const khoa = !cv && !!seedLocked;
  // Điện thoại: vẽ danh sách + khay dưới thay bảng (`veDienThoai`). `khay` = key dòng đang mở, hoặc
  // K_LUC / K_GHI / K_LENH; null = không khay nào mở.
  const hep = useHep();
  const [khay, setKhay] = useState<string | null>(null);
  const [loai, setLoai] = useState<StockRequestKind>(cv?.loai ?? seedLoai ?? "XUAT");
  const [ngayCan, setNgayCan] = useState(cv ? cv.canLuc.slice(0, 10) : seedNgayCan ?? "");
  // Giờ cần "HH:mm" cạnh ngày — rỗng = không đặt giờ, máy chủ chỉ lưu ngày (mở từ công việc thì bắt buộc).
  const [gioCan, setGioCan] = useState(cv ? cv.canLuc.slice(11, 16) : seedGioCan ?? "");
  const [ghiChu, setGhiChu] = useState(cv ? cv.ghiChu : seedGhiChu ?? "");
  const [lines, setLines] = useState<DraftLine[]>(() =>
    cv
      ? cv.dong.map((d) => ({
          ...newLine(d), sl_nen: d.sl_nen, theo_ke_hoach: d.theo_ke_hoach, dvt_nen: d.dvt_nen ?? d.dvt,
          kho_chi_doc: d.kho_chi_doc, canh: d.canh,
        }))
      : seed?.length ? seed.map((s) => newLine(s)) : []);
  // Lệnh mặc định cho DÒNG MỚI thêm vào — đỡ chọn lại lệnh cho từng dòng khi xin cả bộ cho một lệnh.
  const [lenhMoi, setLenhMoi] = useState<{ lsx_id: number | null; bai_ghep_id: number | null; ma: string | null }>(
    { lsx_id: null, bai_ghep_id: null, ma: null },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  // Tồn toàn xưởng theo khoá dạng + khổ, nạp một lần mỗi mã. `null` = không có quyền xem tồn ⇒ ẩn cột.
  const [ton, setTon] = useState<Record<string, TonKhoaRow[] | null>>({});
  const khoaHang = [...new Set(lines.filter((l) => l.hang_loai && l.hang_id).map((l) => `${l.hang_loai}:${l.hang_id}`))];
  useEffect(() => {
    for (const k of khoaHang) {
      if (k in ton) continue;
      const [hl, id] = k.split(":");
      setTon((c) => ({ ...c, [k]: [] }));
      api.kho.phieu
        .tonKhoa(token, hl as HangLoai, Number(id))
        .then((rows) => setTon((c) => ({ ...c, [k]: rows })))
        .catch(() => setTon((c) => ({ ...c, [k]: null })));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, khoaHang.join("|")]);
  // Nhập lại vật tư thừa (mở từ công việc, chiều NHAP) không có cột Tồn — mockup #vat-tu chỉ 3 cột.
  const coTon = !Object.values(ton).some((v) => v === null) && !(cv && loai === "NHAP");
  const coNen = !!cv?.cotNen;

  const mon = lines.filter((l) => l.hang_id);
  const tonDong = (l: DraftLine) => tonCuaDong(l, ton[`${l.hang_loai}:${l.hang_id}`] ?? undefined);
  /** Gốc + số gốc của dòng: giấy khổ hai cạnh xin kg đọc thành tờ, như máy chủ lưu đề nghị. */
  const gocXin = (l: DraftLine) => gocDongXin({
    hangLoai: l.hang_loai, donViGoc: l.don_vi_goc ?? null, rong: l.kho_rong, dai: l.kho_dai,
    slGoc: (Number(l.sl_de_nghi) || 0) * (l.he_so_ve_goc ?? 1),
    gsm: l.dinh_luong ?? ton[`${l.hang_loai}:${l.hang_id}`]?.find((x) => x.dinh_luong)?.dinh_luong,
  });
  const slGoc = (l: DraftLine) => gocXin(l).sl ?? (Number(l.sl_de_nghi) || 0) * (l.he_so_ve_goc ?? 1);
  /** Số tờ khi dòng xin kg được quy ra tờ (giấy khổ hai cạnh); dòng khác null. */
  const toQuy = (l: DraftLine) => {
    const g = gocXin(l);
    return g.goc !== (l.don_vi_goc ?? null) ? g.sl : null;
  };
  // Xin quá tồn: CHỈ cảnh báo, không chặn gửi — kho trả lời cấp được bao nhiêu.
  const quaTon = loai === "XUAT" ? mon.filter((l) => { const t = tonDong(l); return t != null && slGoc(l) > t; }) : [];
  // Tổ nhập lại vật tư thừa không khai đơn giá — đơn giá chỉ ở form Kho.
  const coDonGia = loai === "NHAP" && canViewCost && !khoa && !cv;
  // Đếm đúng số cột: bảng layout FIXED mà colSpan vượt số cột là trình duyệt đẻ thêm cột ảo, bảng co lại.
  const soCot = 2 + (coNen ? 1 : 0) + (coTon ? 1 : 0) + (coDonGia ? 1 : 0) + (khoa ? 0 : 1);
  // Mở từ công việc: giờ cần bắt buộc — thiếu ngày hoặc giờ thì khoá nút gửi.
  const thieuLuc = !!cv && !ghepCanLuc(ngayCan, gioCan);
  const giaTri = mon.reduce((s, l) => s + (Number(l.sl_de_nghi) || 0) * (Number(l.don_gia) || 0), 0);

  function patch(key: string, p: Partial<DraftLine>) {
    setDirty(true);
    patchLang(key, p);
  }
  /** Sửa dòng mà KHÔNG tính là người dùng nhập (ô tự điền giá trị mặc định). */
  function patchLang(key: string, p: Partial<DraftLine>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...p } : l)));
  }

  /** Thêm dòng cho mặt hàng vừa chọn; trả `key` của dòng mới (điện thoại mở khay của nó ngay). */
  function themMon(m: MatHangOption): string {
    setError(null);
    setDirty(true);
    const moi = newLine({
      hang_loai: m.hang_loai,
      hang_id: m.hang_id,
      hang_ma: m.ma,
      hang_ten: m.ten,
      // Mở từ công việc: hàng khác giấy lấy đơn vị lần trước của chính nó (giấy để ô đơn vị tự điền).
      dvt: (m.hang_loai !== "giay" && cv?.dvtGoiY?.(m.hang_loai, m.hang_id)) || "",
      lsx_id: lenhMoi.lsx_id,
      bai_ghep_id: lenhMoi.bai_ghep_id,
      lsx_ma: lenhMoi.lsx_id ? lenhMoi.ma : null,
      bai_ghep_ma: lenhMoi.bai_ghep_id ? lenhMoi.ma : null,
    });
    moi.dinh_luong = m.dinh_luong ?? null;
    setLines((prev) => [...prev, moi]);
    return moi.key;
  }

  function xoaDong(key: string) {
    setDirty(true);
    setLines((prev) => prev.filter((x) => x.key !== key));
  }

  // ── Mảnh dùng chung bảng máy tính và danh sách điện thoại: cùng state, cùng luật, chỉ khác chỗ đặt.
  const thieuCua = (l: DraftLine) => {
    const t = tonDong(l);
    return loai === "XUAT" && t != null ? slGoc(l) - t : 0;
  };
  /** "Thiếu 5 tờ" — theo đơn vị gốc của tồn (giấy / vật tư khác: đơn vị gốc của chính dòng). */
  const chuThieu = (l: DraftLine) =>
    `Thiếu ${fmtQty(thieuCua(l))} ${
      coDonViGoc(l.hang_loai) && l.don_vi_goc
        ? tenGoc(gocXin(l).goc ?? l.don_vi_goc)
        : ton[`${l.hang_loai}:${l.hang_id}`]?.[0]?.don_vi_goc_ten ?? (tenDonVi(l.dvt) || l.dvt)
    }`;
  // Dòng kế hoạch / dòng "Đã xin" của bổ sung: khổ đã chốt, chỉ đọc.
  const khoChiDoc = (l: DraftLine) => khoa || !!l.theo_ke_hoach || !!l.kho_chi_doc;

  function khungKhoCua(l: DraftLine) {
    const rowsTon = ton[`${l.hang_loai}:${l.hang_id}`] ?? [];
    return (
      <KhungKho
        rong={l.kho_rong ?? 0}
        dai={l.kho_dai ?? 0}
        chiDoc={khoChiDoc(l)}
        goiY={rowsTon.filter((r) => r.kho_rong > 0).map((r) => ({ rong: r.kho_rong, dai: r.kho_dai, ghiChu: `Tồn ${fmtQty(r.ton)} ${r.don_vi_goc_ten ?? ""}`.trim() }))}
        onChange={(v) => patch(l.key, { kho_rong: v.rong, kho_dai: v.dai })}
      />
    );
  }

  /** Ô đơn vị của dòng; `null` khi chưa chọn mặt hàng. */
  function oDonVi(l: DraftLine) {
    if (!(l.hang_loai && l.hang_id)) return null;
    return (
      <DonViChonTheoHang
        token={token}
        hangLoai={l.hang_loai}
        hangId={l.hang_id}
        gon
        value={l.dvt}
        // Ô đang trống mà đổi = ô TỰ ĐIỀN đơn vị gốc, không phải người gõ:
        // không tính là đang nhập dở (đóng ngăn khỏi hỏi "Bỏ nội dung…").
        onChange={(ma, hs) => (l.dvt ? patch : patchLang)(l.key, { dvt: ma, he_so_ve_goc: hs })}
        // Giấy / vật tư khác: nhớ đơn vị gốc của nhóm đang chọn (tờ / kg / thùng) để cột Tồn khớp
        // đúng dòng. Bắn cả với dòng nạp sẵn, nên không chờ người dùng bấm đổi đơn vị.
        onQuyDoi={(info) => {
          const goc = coDonViGoc(l.hang_loai) ? info?.goc ?? null : null;
          if (goc !== (l.don_vi_goc ?? null)) patchLang(l.key, { don_vi_goc: goc });
        }}
      />
    );
  }

  /** Ô số lượng + đơn vị. `lon` = ô số lớn trong khay điện thoại: tự lấy tiêu điểm, chạm vào là bôi số. */
  function oSoLuong(l: DraftLine, lon = false) {
    // Dòng kế hoạch để 0 là hợp lệ ("không cần cấp") ⇒ hiện số 0, không tô lỗi. Dòng
    // nạp sẵn có số nền (dòng "Đã xin" của bổ sung) để 0 = không xin thêm, cũng vậy.
    const loi = l.hang_id && !l.theo_ke_hoach && l.sl_nen == null && !(Number(l.sl_de_nghi) > 0);
    return (
      <label className={`ycf-gi dfa-gi${lon ? " kfd-lon" : ""}${loi ? " loi" : ""}`}>
        {/* Ô giữ CHỮ đang gõ ("1," chưa xong vẫn hiện) — dựng lại chữ từ số mỗi phím là nuốt dấu phẩy
            (L-SX-06). Dòng kế hoạch / dòng có số nền để 0 là hợp lệ ⇒ hiện số 0. */}
        <OSoLe
          aria-label={`Số lượng ${l.hang_ten ?? ""}`}
          hienSo0={!!(l.theo_ke_hoach || l.sl_nen != null)}
          value={Number(l.sl_de_nghi) > 0 ? Number(l.sl_de_nghi) : 0}
          onChange={(v) => patch(l.key, { sl_de_nghi: v })}
          data-tu-chon={lon ? "" : undefined}
          onFocus={lon ? (e) => e.currentTarget.select() : undefined}
        />
        {oDonVi(l)}
      </label>
    );
  }

  /** Dòng trống chưa chọn mặt hàng: ô tìm vật tư. */
  function oChonHang(l: DraftLine) {
    return (
      <MaterialCombobox token={token} hangTen={l.hang_ten} onPick={(m) => patch(l.key, {
        hang_loai: m.hang_loai, hang_id: m.hang_id, hang_ma: m.ma, hang_ten: m.ten,
        dvt: "", he_so_ve_goc: null, don_vi_goc: null, kho_rong: 0, kho_dai: 0,
      })} />
    );
  }

  function oDonGia(l: DraftLine) {
    return (
      <label className="ycf-gi dfa-gi">
        <input
          inputMode="numeric"
          aria-label="Đơn giá"
          value={l.don_gia != null ? l.don_gia.toLocaleString("vi-VN") : ""}
          onChange={(e) => {
            const so = e.target.value.replace(/\D/g, "");
            patch(l.key, { don_gia: so ? Number(so) : null });
          }}
        />
        <span>đ</span>
      </label>
    );
  }

  /** Mở từ công việc: gửi qua đường của tổ. Dòng kế hoạch đi cả khi số 0 — đó là tín hiệu "không cần
   *  cấp món này"; dòng thêm ngoài kế hoạch mà để 0 thì bỏ. */
  async function guiTuCongViec(cv: TuCongViec) {
    const canLuc = ghepCanLuc(ngayCan, gioCan);
    if (!canLuc) {
      setError(loai === "NHAP" ? "Chọn ngày và giờ cần nhập." : "Chọn ngày và giờ cần xuất.");
      return;
    }
    const dong = lines.filter((l) => l.hang_id && (l.theo_ke_hoach || Number(l.sl_de_nghi) > 0));
    if (!dong.length && !cv.choPhepRong) {
      setError("Thêm ít nhất một dòng vật tư có số lượng lớn hơn 0.");
      return;
    }
    // Cả form một lệnh nên trùng chỉ xét mã + khổ + đơn vị gốc (dòng thêm tay chưa mang id lệnh).
    const khoaDong = dong.map((l) => khoaTrungDong(l, ""));
    if (new Set(khoaDong).size !== khoaDong.length) {
      setError("Một mặt hàng chỉ được xuất hiện 1 dòng — gộp số lượng lại.");
      return;
    }
    const thieuDv = dong.find((l) => Number(l.sl_de_nghi) > 0 && !l.dvt);
    if (thieuDv) {
      setError(`“${thieuDv.hang_ten ?? "Vật tư"}”: chọn đơn vị tính.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await cv.onGui({ can_luc: canLuc, ghi_chu: ghiChu.trim() || null, dong });
      setDirty(false);
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Không lưu được yêu cầu.");
    } finally {
      setBusy(false);
    }
  }

  async function guiKho() {
    if (cv) return guiTuCongViec(cv);
    const body = payloadDong(lines, loai);
    if (!body.length) {
      setError("Thêm ít nhất một dòng vật tư có số lượng lớn hơn 0.");
      return;
    }
    // Trùng mặt hàng (cùng mã, cùng lệnh, cùng khổ + đơn vị gốc): chặn với đúng câu máy chủ trả.
    const khoaDong = lines
      .filter((l) => l.hang_loai && l.hang_id && l.dvt && Number(l.sl_de_nghi) > 0)
      .map((l) => khoaTrungDong(l, `${l.lsx_id ?? ""}:${l.bai_ghep_id ?? ""}`));
    if (new Set(khoaDong).size !== khoaDong.length) {
      setError("Một mặt hàng cho cùng một lệnh chỉ được xuất hiện 1 dòng — gộp số lượng lại.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.kho.deNghi.create(token, {
        loai,
        ngay_can: ngayCan || null,
        can_luc: ghepCanLuc(ngayCan, gioCan),
        ghi_chu: ghiChu || null,
        // Gắn nguồn đợt giao (mở từ nút "Nhập kho") — máy chủ chặn nhập lần hai cho cùng đợt (409).
        purchase_delivery_id: seedDeliveryId ?? null,
        lines: body,
      });
      setDirty(false);
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Không lưu được yêu cầu.");
    } finally {
      setBusy(false);
    }
  }

  const nhanLuc = loai === "NHAP" ? "Cần nhập lúc" : "Cần xuất lúc";
  const nhanSo = cv ? cv.nhanSoLuong : loai === "NHAP" ? "Số lượng nhập" : "Số lượng xin";

  const segLoai = (
    <div className="kho-shell__dirs kho-chieu" role="radiogroup" aria-label="Loại yêu cầu">
      {(["NHAP", "XUAT"] as const).map((k) => (
        <button
          key={k}
          type="button"
          role="radio"
          aria-checked={loai === k}
          className={`seg${loai === k ? " is-active" : ""}`}
          onClick={() => { setDirty(true); setLoai(k); }}
        >
          {k === "NHAP" ? "Nhập" : "Xuất"}
        </button>
      ))}
    </div>
  );

  const oNgayGio = (
    <div className="kna-ngay-gio">
      <ChonNgay
        className="kna-o"
        aria-label={loai === "NHAP" ? "Ngày cần nhập" : "Ngày cần xuất"}
        value={ngayCan}
        min={khoa ? undefined : todayISO()}
        disabled={khoa}
        required={!!cv}
        onChange={(v) => { setDirty(true); setNgayCan(v); }}
      />
      {/* Giờ không khoá theo đợt giao: đợt chỉ biết ngày nhận, giờ do người lập điền. */}
      <ChonGio
        className="kna-o"
        aria-label={loai === "NHAP" ? "Giờ cần nhập" : "Giờ cần xuất"}
        value={gioCan}
        required={!!cv}
        onChange={(v) => { setDirty(true); setGioCan(v); }}
      />
    </div>
  );

  // Mốc "Lúc bắt đầu việc" (chỉ chiều xuất mở từ công việc) — chip chọn nhanh + chữ mờ ở dòng điện thoại.
  const mocBatDau = cv && loai === "XUAT" && cv.lucBatDauViec
    ? { ngay: cv.lucBatDauViec.slice(0, 10), gio: cv.lucBatDauViec.slice(11, 16) }
    : null;
  const dungMocBatDau = !!mocBatDau && ngayCan === mocBatDau.ngay && gioCan === mocBatDau.gio;

  const chonNhanhLuc = !khoa && (
    <div className="ycf-pick" role="group" aria-label="Chọn nhanh ngày cần">
      {CHON_NGAY.map((c) => {
        const ngay = cachHomNay(c.ngay);
        return (
          <button key={c.nhan} type="button" className={ngayCan === ngay ? "on" : ""}
            onClick={() => { setDirty(true); setNgayCan(ngay); }}>
            {c.nhan}
          </button>
        );
      })}
      {mocBatDau && (
        <button type="button" className={dungMocBatDau ? "on" : ""}
          onClick={() => { setDirty(true); setNgayCan(mocBatDau.ngay); setGioCan(mocBatDau.gio); }}>
          Lúc bắt đầu việc
        </button>
      )}
    </div>
  );

  const nguonKv = (
    <dl className="kna-kv">
      {seedDonMuaMa && (<><dt>Đơn mua</dt><dd>{seedDonMuaMa}</dd></>)}
      {seedDotSo != null && (<><dt>Đợt giao</dt><dd>Đợt {seedDotSo}</dd></>)}
      {seedNccTen && (<><dt>Nhà cung cấp</dt><dd>{seedNccTen}</dd></>)}
      {ngayCan && (<><dt>Ngày nhận</dt><dd>{fmtDateISO(ngayCan)}</dd></>)}
      {seedHoaDon && (<><dt>Hoá đơn</dt><dd>{seedHoaDon}</dd></>)}
    </dl>
  );

  const chonLenhMoi = (
    <LenhChon
      token={token}
      lsxId={lenhMoi.lsx_id}
      baiGhepId={lenhMoi.bai_ghep_id}
      nhan={lenhMoi.ma ?? ""}
      onChange={(lsxId, bgId, ma) => setLenhMoi({ lsx_id: lsxId, bai_ghep_id: bgId, ma })}
    />
  );

  /** Ô ghi chú; trong khay điện thoại (`khay`) tự lấy tiêu điểm và mang nhãn riêng (không có <label> bọc). */
  function oGhiChu(trongKhay = false) {
    return (
      <textarea
        className="kna-o ycf-ta"
        rows={trongKhay ? 4 : 3}
        value={ghiChu}
        placeholder={cv && loai === "NHAP" ? "Ví dụ thừa do hỏng ít" : "Lý do xin, ai ra nhận…"}
        onChange={(e) => { setDirty(true); setGhiChu(e.target.value); }}
        aria-label={trongKhay ? "Ghi chú" : undefined}
        data-tu-chon={trongKhay ? "" : undefined}
      />
    );
  }

  /** Chữ nền của dòng: "kế hoạch 175" / "đã xin 175" / "ngoài kế hoạch". `trongKhay` = câu viết hoa kèm
   *  đơn vị ở đầu khay. Form Kho thường không có cột nền: dòng điện thoại nói lệnh của dòng. */
  function chuNen(l: DraftLine, trongKhay = false): string {
    if (!cv) return !trongKhay && (l.lsx_id || l.bai_ghep_id || l.lsx_ma || l.bai_ghep_ma) ? lenhNhan(l) : "";
    if (!cv.cotNen) return "";
    let chu: string;
    if (l.sl_nen == null) {
      if (cv.cotNen !== "Kế hoạch") return "";
      chu = "ngoài kế hoạch";
    } else {
      const dvNen = tenDonVi(l.dvt_nen ?? "") || l.dvt_nen || "";
      // Dòng chỉ kèm đơn vị khi nó khác đơn vị của số xin (số to bên phải đã nói đơn vị).
      const kemDv = trongKhay || (l.dvt_nen ?? l.dvt) !== l.dvt;
      chu = `${cv.cotNen.toLowerCase()} ${fmtQty(l.sl_nen)}${kemDv && dvNen ? ` ${dvNen}` : ""}`;
    }
    return trongKhay ? chu.charAt(0).toUpperCase() + chu.slice(1) : chu;
  }

  /** ĐIỆN THOẠI (≤640px) — phương án C (docs/mockups/ban-to-vat-tu-dien-thoai-3-phuong-an.html, chi tiết ở
   *  ban-to-hop-thoai-B `#vtPhone`): danh sách chỉ đọc, chạm dòng thì khay dưới trồi lên để sửa số, khổ,
   *  Về 0 / Bỏ dòng; Cần … lúc và Ghi chú thu thành một dòng, chạm mới mở. Cùng state, cùng luật kiểm
   *  và cùng `guiKho` với bảng máy tính — chỉ khác cách vẽ. Mở từ công việc thì không có thẻ Lệnh sản
   *  xuất: đầu ngăn đã nói tên việc. */
  function veDienThoai() {
    const chuLuc = ngayCan
      ? gioCan ? ngayGioNgan(`${ngayCan}T${gioCan}`) : `${ngayCan.slice(8, 10)}/${ngayCan.slice(5, 7)}`
      : null;
    const dongMo = lines.find((l) => l.key === khay) ?? null;
    const dongDong = () => setKhay(null);

    return (
      <NganPhai
        tieuDe={cv ? cv.tieuDe : loai === "NHAP" ? "Yêu cầu nhập kho" : "Yêu cầu xuất kho"}
        phuDe={cv ? <span className="kfd-ab-s">{cv.lenh.congDoan} của {cv.lenh.ma}</span>
          : khoa ? <span className="kfd-ab-s">Nhập từ đợt giao</span> : undefined}
        chan={<><span className="kfd-dem">{mon.length} mặt hàng</span>{nutGui}</>}
        onDong={onClose}
        chanDong={() => dirty && !busy}
      >
        <div className="kfd">
          {error && <div className="kna-canh kna-canh--do kfd-loi" role="alert">{error}</div>}
          {!khoa && !cv && <div className="kfd-ctx kfd-ctx--tinh">{segLoai}</div>}
          <button type="button" className="kfd-ctx" onClick={() => setKhay(K_LUC)}>
            <span className="kfd-ctx__n">{nhanLuc}</span>
            {/* Mở từ công việc thì giờ bắt buộc: thiếu ngày hoặc giờ là chữ đỏ (nút gửi đang khoá vì nó). */}
            <span className={`kfd-ctx__v${thieuLuc ? " kfd-do" : chuLuc ? "" : " kfd-mo"}`}>
              {chuLuc ?? "Chưa chọn"}{thieuLuc && chuLuc ? " chưa có giờ" : ""}
            </span>
            {dungMocBatDau && <span className="kfd-mo kfd-nho">lúc bắt đầu việc</span>}
            <span className="kfd-ar" aria-hidden="true">›</span>
          </button>
          {khoa && <div className="kfd-nguon">{nguonKv}</div>}
          {!khoa && !cv && (
            <button type="button" className="kfd-ctx" onClick={() => setKhay(K_LENH)}>
              <span className="kfd-ctx__n">Lệnh cho dòng mới</span>
              <span className={`kfd-ctx__v${lenhMoi.ma ? "" : " kfd-mo"}`}>{lenhMoi.ma ?? "Không theo lệnh"}</span>
              <span className="kfd-ar" aria-hidden="true">›</span>
            </button>
          )}

          <div className="kfd-nhom">Vật tư</div>
          {lines.length === 0 && <div className="kfd-trong">Chưa có vật tư.</div>}
          {lines.map((l) => {
            const t = tonDong(l);
            const so = Number(l.sl_de_nghi) || 0;
            const loi = !khoa && l.hang_id && !l.theo_ke_hoach && l.sl_nen == null && !(so > 0);
            const dv = tenDonVi(l.dvt) || l.dvt;
            const kho = l.hang_loai === "giay" || (coKho(l.hang_loai) && l.kho_rong)
              ? nhanKho(...chuanKho(l.kho_rong, l.kho_dai)) : "";
            const ben = chuNen(l);
            const noiDung = (
              <>
                <span className="kfd-dong__ten">{l.hang_ten ?? "Chưa chọn vật tư"}</span>
                <span className={`kfd-dong__so${loi ? " kfd-do" : so > 0 ? "" : " kfd-mo"}`}>
                  {fmtQty(so)}{dv && <small>{dv}</small>}
                </span>
                {!khoa && <span className="kfd-ar" aria-hidden="true">›</span>}
                {cv && l.canh && !l.dvt ? (
                  <span className="kfd-dong__canh">Chưa có đơn vị tính</span>
                ) : (
                  <>
                    <span className="kfd-dong__phu">
                      {kho && <span>{kho}</span>}
                      {/* Nhập từ đợt giao: cùng nghĩa cột "Tồn khổ này sau nhập" của bảng máy tính. */}
                      {coTon && t != null && (
                        khoa ? (
                          t <= 0 ? <span>{l.hang_loai === "giay" ? "Khổ mới trong kho" : "Chưa có trong kho"}</span> : (
                            <><span>Tồn {fmtQty(t)}</span><span>sau nhập {fmtQty(t + slGoc(l))}</span></>
                          )
                        ) : (
                          <span>Tồn {fmtQty(t)}</span>
                        )
                      )}
                    </span>
                    <span className="kfd-dong__phu2">{ben}</span>
                  </>
                )}
                {thieuCua(l) > 0 && <span className="kfd-dong__canh">{chuThieu(l)}</span>}
              </>
            );
            return (
              <div key={l.key}>
                {khoa ? (
                  <div className="kfd-dong">{noiDung}</div>
                ) : (
                  <button type="button" className="kfd-dong" onClick={() => setKhay(l.key)}>{noiDung}</button>
                )}
                {/* Ô đơn vị chỉ nằm trong khay, mà nó là chỗ TỰ ĐIỀN đơn vị gốc cho dòng còn trống đơn vị
                    — dựng ẩn để state y như bản máy tính (câu cam tắt, dòng gửi đi có đơn vị). */}
                {!khoa && !l.dvt && khay !== l.key && <span hidden>{oDonVi(l)}</span>}
              </div>
            );
          })}
          {!khoa && (
            <div className="kfd-them">
              <MaterialCombobox
                key={lines.length}
                token={token}
                hangTen={null}
                placeholder="+ Thêm vật tư"
                onPick={(m) => setKhay(themMon(m))}
              />
            </div>
          )}
          {/* Thẻ "Giá trị nhập" của bản máy tính: dòng tổng, dưới là tiền từng món (tên + số tiền). */}
          {khoa && canViewCost && giaTri > 0 && (
            <div className="kfd-gt">
              <div className="kfd-ctx kfd-ctx--tinh">
                <span className="kfd-ctx__n">Giá trị nhập</span>
                <span className="kfd-ctx__v">{giaTri.toLocaleString("vi-VN")} đ</span>
                <span className="kfd-mo kfd-nho">chưa VAT</span>
              </div>
              {mon.map((l) => (
                <div key={l.key} className="kfd-gt__mon">
                  <span>{l.hang_ten}</span>
                  <span className="kna-so">{((Number(l.sl_de_nghi) || 0) * (Number(l.don_gia) || 0)).toLocaleString("vi-VN")}</span>
                </div>
              ))}
            </div>
          )}
          <button type="button" className="kfd-ctx" onClick={() => setKhay(K_GHI)}>
            <span className="kfd-ctx__n">Ghi chú</span>
            <span className={`kfd-ctx__v kfd-ctx__v--cat${ghiChu.trim() ? "" : " kfd-mo"}`}>{ghiChu.trim() || "Không bắt buộc"}</span>
            <span className="kfd-ar" aria-hidden="true">›</span>
          </button>
        </div>

        {dongMo && (
          <KhayDuoi
            tieuDe={dongMo.hang_ten ?? "Vật tư"}
            phu={(chuNen(dongMo, true) || (coTon && tonDong(dongMo) != null)) && (
              <div className="kfd-khay__s">
                {chuNen(dongMo, true) && <span>{chuNen(dongMo, true)}</span>}
                {coTon && tonDong(dongMo) != null && <span>Tồn {fmtQty(tonDong(dongMo) as number)}</span>}
              </div>
            )}
            onDong={dongDong}
          >
            {!dongMo.hang_id && oChonHang(dongMo)}
            {cv && dongMo.canh && !dongMo.dvt && <div className="kfd-lb kfd-cam">{dongMo.canh}</div>}
            {coKho(dongMo.hang_loai) && dongMo.hang_id && (
              <>
                <div className="kfd-lb">Khổ</div>
                {khungKhoCua(dongMo)}
              </>
            )}
            <div className="kfd-lb">{nhanSo}</div>
            {oSoLuong(dongMo, true)}
            {thieuCua(dongMo) > 0 && <div className="kfd-cam kfd-nho">{chuThieu(dongMo)}</div>}
            {!cv && dongMo.hang_id && (
              <>
                <div className="kfd-lb">Lệnh sản xuất</div>
                <LenhDong
                  token={token}
                  lsxId={dongMo.lsx_id ?? null}
                  baiGhepId={dongMo.bai_ghep_id ?? null}
                  nhan={dongMo.lsx_ma ?? dongMo.bai_ghep_ma ?? ""}
                  onChange={(lsxId, bgId, ma) => patch(dongMo.key, {
                    lsx_id: lsxId, bai_ghep_id: bgId,
                    lsx_ma: lsxId ? ma : null, bai_ghep_ma: bgId ? ma : null,
                  })}
                />
              </>
            )}
            {coDonGia && (
              <>
                <div className="kfd-lb">Đơn giá</div>
                {oDonGia(dongMo)}
              </>
            )}
            <div className="kfd-hang">
              {cv && dongMo.theo_ke_hoach ? (
                // Dòng kế hoạch không xoá được: Về 0 = tổ không cần cấp món này.
                <Button variant="secondary" onClick={() => { patch(dongMo.key, { sl_de_nghi: 0 }); dongDong(); }}>Về 0</Button>
              ) : (
                <Button variant="secondary" onClick={() => { xoaDong(dongMo.key); dongDong(); }}>Bỏ dòng</Button>
              )}
              <Button variant="accent" onClick={dongDong}>Xong</Button>
            </div>
          </KhayDuoi>
        )}
        {khay === K_LUC && (
          <KhayDuoi tieuDe={nhanLuc} onDong={dongDong}>
            <div className="kfd-lb">Ngày và giờ</div>
            {oNgayGio}
            {chonNhanhLuc && <div className="kfd-chip">{chonNhanhLuc}</div>}
            <div className="kfd-hang"><Button variant="accent" onClick={dongDong}>Xong</Button></div>
          </KhayDuoi>
        )}
        {khay === K_GHI && (
          <KhayDuoi tieuDe="Ghi chú" onDong={dongDong}>
            {oGhiChu(true)}
            <div className="kfd-hang"><Button variant="accent" onClick={dongDong}>Xong</Button></div>
          </KhayDuoi>
        )}
        {khay === K_LENH && (
          <KhayDuoi tieuDe="Lệnh cho dòng mới" onDong={dongDong}>
            <div className="kfd-lb">Dòng mới lấy lệnh này</div>
            {chonLenhMoi}
            <div className="kfd-hang"><Button variant="accent" onClick={dongDong}>Xong</Button></div>
          </KhayDuoi>
        )}
      </NganPhai>
    );
  }

  // Mở từ công việc: quyền gửi đã chặn ở nút mở form của bàn tổ.
  const nutGui = (canRequest || cv) && (
    <Button variant="accent" onClick={() => void guiKho()} loading={busy} disabled={thieuLuc}
      title={thieuLuc ? "Chọn đủ ngày và giờ cần" : undefined}>
      <Icon name="send" size={14} /> {cv ? cv.nutGui : "Gửi kho"}
    </Button>
  );

  const chan = (
    <>
      <span className="ycf-xt">
        <b>{mon.length} mặt hàng</b>
        {quaTon.length > 0 && (
          <span className="ycd-vang">
            {quaTon.length === 1 ? `${quaTon[0].hang_ten} xin quá tồn` : `${quaTon.length} mặt hàng xin quá tồn`}
          </span>
        )}
      </span>
      <span className="rc__spacer" />
      <Button variant="ghost" onClick={onClose} disabled={busy}>Huỷ</Button>
      {nutGui}
    </>
  );

  if (hep) return veDienThoai();

  return (
    <NganPhai
      duongDan={cv ? cv.duongDan : khoa ? "Kho > Yêu cầu nhập xuất > Nhập từ đợt giao" : "Kho > Yêu cầu nhập xuất > Tạo mới"}
      tieuDe={cv ? cv.tieuDe : loai === "NHAP" ? "Yêu cầu nhập kho" : "Yêu cầu xuất kho"}
      // Nguồn (đơn mua, đợt) chỉ nói ở thẻ Nguồn cột phải — không lặp thành thẻ đầu ngăn hay chữ ở chân.
      chan={chan}
      onDong={onClose}
      chanDong={() => dirty && !busy}
    >
      <div className="kna">
        {error && <div className="kna-canh kna-canh--do" role="alert">{error}</div>}
        <div className="kna-luoi dfa-luoi">
          <div className="kna-cot">
            <section className="kna-the kna-the--cat">
              <div className="kna-the__dau">
                <h3>Vật tư</h3>
                <span className="kna-tag">{mon.length} mặt hàng</span>
                {khoa && <span className="kna-mo dga-nut">Khoá theo đợt giao</span>}
              </div>
              <div className="lds-bang lds-bang--nhap">
                <table className="lds-g kna-tren">
                  <colgroup>
                    <col />
                    {coNen && <col style={{ width: 100 }} />}
                    {coTon && <col style={{ width: khoa ? 200 : cv ? 90 : 96 }} />}
                    <col style={{ width: cv ? 170 : 140 }} />
                    {coDonGia && <col style={{ width: 124 }} />}
                    {!khoa && <col style={{ width: cv ? 56 : 48 }} />}
                  </colgroup>
                  <thead>
                    <tr>
                      <th>Vật tư</th>
                      {coNen && <th className="n">{cv?.cotNen}</th>}
                      {coTon && <th className="n">{khoa ? (lines.some((x) => x.hang_loai === "giay") ? "Tồn khổ này sau nhập" : "Tồn sau nhập") : "Tồn"}</th>}
                      <th className="n">{nhanSo}</th>
                      {coDonGia && <th className="n">Đơn giá</th>}
                      {!khoa && <th />}
                    </tr>
                  </thead>
                  <tbody>
                    {lines.length === 0 && (
                      <tr>
                        <td colSpan={soCot} className="lds-trong">Chưa có vật tư. Gõ tên hoặc mã ở ô bên dưới để thêm.</td>
                      </tr>
                    )}
                    {lines.map((l) => {
                      const t = tonDong(l);
                      const dv = tenDonVi(l.dvt) || l.dvt;
                      const thieu = thieuCua(l);
                      return (
                        <tr key={l.key}>
                          <td>
                            {l.hang_id ? (
                              // Tên + lệnh của dòng chung một hàng, khổ ở hàng dưới: Nhập có thêm cột Đơn giá
                              // nên cột này hẹp hơn Xuất — để khổ và lệnh chung hàng là bên Nhập bị đẩy xuống
                              // dòng, hai chiều trông khác nhau (user phản ánh 07/10/2026).
                              <div className="ycf-ten">
                                <span className="kna-hang__ten" title={l.hang_ma ?? undefined}>{l.hang_ten}</span>
                                {/* Mở từ công việc: cả form một lệnh (thẻ khoá bên phải), dòng không lặp thẻ lệnh. */}
                                {cv ? null : khoa ? (
                                  (l.lsx_ma || l.bai_ghep_ma) && <span className="kna-tag">{lenhNhan(l)}</span>
                                ) : (
                                  <LenhDong
                                    token={token}
                                    lsxId={l.lsx_id ?? null}
                                    baiGhepId={l.bai_ghep_id ?? null}
                                    nhan={l.lsx_ma ?? l.bai_ghep_ma ?? ""}
                                    onChange={(lsxId, bgId, ma) => patch(l.key, {
                                      lsx_id: lsxId, bai_ghep_id: bgId,
                                      lsx_ma: lsxId ? ma : null, bai_ghep_ma: bgId ? ma : null,
                                    })}
                                  />
                                )}
                              </div>
                            ) : (
                              oChonHang(l)
                            )}
                            {coKho(l.hang_loai) && l.hang_id && <div className="ycf-phu">{khungKhoCua(l)}</div>}
                            {cv && l.canh && !l.dvt && <div className="kna-thieu-dv">{l.canh}</div>}
                          </td>
                          {coNen && (
                            <td className="n">
                              {l.sl_nen != null ? (
                                <><span className="kna-so">{fmtQty(l.sl_nen)}</span> <span className="kna-dv">{tenDonVi(l.dvt_nen ?? "") || l.dvt_nen}</span></>
                              ) : (
                                <span className="kna-mo">—</span>
                              )}
                            </td>
                          )}
                          {coTon && (
                            <td className="n">
                              {t == null ? (
                                <span className="kna-mo">{l.hang_loai === "giay" ? "Theo khổ" : ""}</span>
                              ) : khoa ? (
                                t <= 0 ? (
                                  <><span className="kna-tag">{l.hang_loai === "giay" ? "Khổ mới trong kho" : "Chưa có trong kho"}</span> <b className="kna-so">{fmtQty(slGoc(l))}</b></>
                                ) : (
                                  <><span className="kna-so kna-mo">{fmtQty(t)}</span> <span className="kna-mo">đến</span> <b className="kna-so">{fmtQty(t + slGoc(l))}</b></>
                                )
                              ) : (
                                <><span className="kna-so">{fmtQty(t)}</span>{toQuy(l) != null && <span className="kna-dv"> tờ</span>}</>
                              )}
                            </td>
                          )}
                          <td className="n">
                            {khoa ? (
                              <><b className="kna-so">{fmtQty(l.sl_de_nghi)}</b> <span className="kna-dv">{dv}</span></>
                            ) : (
                              oSoLuong(l)
                            )}
                            {toQuy(l) != null && Number(l.sl_de_nghi) > 0 && <div className="dfa-duoi">≈ {fmtQty(toQuy(l)!)} tờ</div>}
                            {thieu > 0 && <div className="dfa-duoi ycd-vang">{chuThieu(l)}</div>}
                          </td>
                          {coDonGia && (
                            <td className="n">{oDonGia(l)}</td>
                          )}
                          {!khoa && (
                            <td className="n">
                              {cv && l.theo_ke_hoach ? (
                                // Dòng kế hoạch không xoá được: Về 0 = tổ không cần cấp món này.
                                <button
                                  type="button"
                                  className="lds-lk kna-ve-0"
                                  aria-label={`Về 0 ${l.hang_ten ?? ""}`.trim()}
                                  onClick={() => patch(l.key, { sl_de_nghi: 0 })}
                                >
                                  Về 0
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className="ycf-xoa"
                                  aria-label={`Xoá ${l.hang_ten ?? "dòng"}`}
                                  onClick={() => xoaDong(l.key)}
                                >
                                  <Icon name={cv ? "x" : "trash"} size={14} />
                                </button>
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {!khoa && (
                <div className="ycf-dong-them">
                  <MaterialCombobox
                    key={lines.length}
                    token={token}
                    hangTen={null}
                    placeholder="Thêm vật tư: gõ tên hoặc mã…"
                    onPick={(m) => themMon(m)}
                  />
                  {cv?.goiY && <div className="kna-goi-duoi">{cv.goiY}</div>}
                </div>
              )}
            </section>
          </div>

          <div className="kna-cot">
            <section className="kna-the">
              <div className="kna-the__than kna-form">
                {/* Mở từ công việc: chiều đã biết theo nút bấm ở tab Vật tư, không cho đổi. */}
                {!khoa && !cv && segLoai}
                <div className="kna-o-truong">
                  <span>{nhanLuc} <em>*</em></span>
                  {oNgayGio}
                </div>
                {chonNhanhLuc}
              </div>
            </section>

            {cv ? (
              <section className="kna-the">
                <div className="kna-the__dau">
                  <h3>Lệnh sản xuất</h3>
                  <span className="kna-mo dga-nut">khoá theo công việc</span>
                </div>
                <div className="kna-the__than kna-form">
                  <div className="kna-o kna-o--khoa kna-lenh-khoa">
                    <span>{cv.lenh.ma}</span>
                    <span>{cv.lenh.ten}</span>
                  </div>
                  <dl className="kna-kv kna-kv--trai">
                    <dt>Công đoạn</dt><dd>{cv.lenh.congDoan}</dd>
                    <dt>Tổ</dt><dd>{cv.lenh.to}</dd>
                    {cv.lenh.lan && (
                      <><dt>Lần</dt><dd>Lần {cv.lenh.lan.so}<small>{cv.lenh.lan.nguoi} lúc {ngayGioNgan(cv.lenh.lan.luc)}</small></dd></>
                    )}
                  </dl>
                </div>
              </section>
            ) : khoa ? (
              <section className="kna-the">
                <div className="kna-the__dau"><h3>Nguồn</h3></div>
                <div className="kna-the__than">{nguonKv}</div>
              </section>
            ) : (
              <section className="kna-the">
                <div className="kna-the__dau">
                  <h3>Lệnh sản xuất</h3>
                  <span className="kna-mo dga-nut">dòng mới lấy lệnh này</span>
                </div>
                <div className="kna-the__than tyc-lenh tyc-lenh--rong">{chonLenhMoi}</div>
              </section>
            )}

            {khoa && canViewCost && giaTri > 0 && (
              <section className="kna-the">
                <div className="kna-the__dau"><h3>Giá trị nhập</h3></div>
                <div className="kna-the__than dfa-cs">
                  {mon.map((l) => (
                    <div key={l.key} className="dfa-cs__con" style={{ paddingLeft: 0 }}>
                      <span>{l.hang_ten}</span>
                      <span className="kna-so">{((Number(l.sl_de_nghi) || 0) * (Number(l.don_gia) || 0)).toLocaleString("vi-VN")}</span>
                    </div>
                  ))}
                  <div className="dfa-cs__tong"><span>Chưa VAT</span><b className="kna-so">{giaTri.toLocaleString("vi-VN")} đ</b></div>
                </div>
              </section>
            )}

            <section className="kna-the">
              <div className="kna-the__than kna-form">
                <label className="kna-o-truong">
                  <span>Ghi chú</span>
                  {oGhiChu()}
                </label>
              </div>
            </section>
          </div>
        </div>
      </div>
    </NganPhai>
  );
}

/** Dòng gửi máy chủ — chỉ dòng đủ mặt hàng + đơn vị + số > 0. Giấy mang khổ chuẩn hoá; đơn vị gốc
 *  KHÔNG gửi — máy chủ tự suy từ `dvt`. */
function payloadDong(lines: DraftLine[], loai: StockRequestKind): StockRequestLineInput[] {
  const isNhap = loai === "NHAP";
  return lines
    .filter((l) => l.hang_loai && l.hang_id && l.dvt && Number(l.sl_de_nghi) > 0)
    .map((l) => ({
      hang_loai: l.hang_loai as HangLoai,
      hang_id: l.hang_id as number,
      ...(coKho(l.hang_loai)
        ? {
            kho_rong: chuanKho(l.kho_rong, l.kho_dai)[0],
            kho_dai: chuanKho(l.kho_rong, l.kho_dai)[1],
          }
        : {}),
      dvt: l.dvt,
      sl_de_nghi: Number(l.sl_de_nghi),
      // Đơn giá chỉ gửi cho yêu cầu NHẬP (người yêu cầu biết giá NCC). XUẤT lấy giá vốn từ lô.
      don_gia: isNhap && l.don_gia != null ? Number(l.don_gia) : null,
      lsx_id: l.lsx_id ?? null,
      bai_ghep_id: l.bai_ghep_id ?? null,
      ghi_chu: l.ghi_chu || null,
    }));
}

/** Khoá chống trùng dòng — phản chiếu `khoa_dong` của máy chủ: mã + khổ (giấy) + đơn vị gốc (giấy,
 *  vật tư khác), kèm `them` (lệnh) khi nơi gọi cần. Chưa rõ đơn vị gốc thì lấy tạm `dvt` — cùng đơn
 *  vị chắc chắn cùng nhóm. */
function khoaTrungDong(l: DraftLine, them: string): string {
  if (!coDonViGoc(l.hang_loai)) return `${l.hang_loai}:${l.hang_id}:${them}`;
  const [r, d] = chuanKho(l.kho_rong, l.kho_dai);
  return `${l.hang_loai}:${l.hang_id}:${them}:${l.don_vi_goc || l.dvt}:${r}:${d}`;
}

// ── INLINE SVG ICONS ─────────────────────────────────────────────────────────
const PlusIcon = () => (
  <svg
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="3"
    strokeLinecap="round"
  >
    <path d="M12 5v14M5 12h14" />
  </svg>
);
