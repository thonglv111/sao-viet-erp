// BÀN KẾ HOẠCH SẢN XUẤT — controller master↔detail (không react-router, điều hướng bằng state).
//
// Luồng: Sale bấm "Chuyển xuống sản xuất" ở Đơn hàng → đơn rơi vào tab HÀNG CHỜ (real-time qua SSE,
// `eventTick` đổi → refetch) → mở đơn xem DANH SÁCH LỆNH DỰ KIẾN → tick → tạo lệnh → sang tab LỆNH
// SẢN XUẤT sửa routing/số lượng → đánh dấu "Sẵn sàng lập kế hoạch".
//
// Lát này DỪNG ở trạng thái "sẵn sàng": chưa ghép bài, chưa xếp lịch, chưa phát xuống xưởng.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError,
  api,
  type HangChoItem,
  type LsxListGiaCong,
  type LsxListItem,
  type LsxTongQuanOut,
  type LsxTrangThai,
} from "../api/client";
import { useAuth } from "../auth/useAuth";
import { useCan, useScopeOf } from "../auth/permissions";
import {
  ChipTT,
  ChonCot,
  CuonLuoi,
  LocNhanhTrangThai,
  OTim,
  rongLuoi,
  tenKhachGon,
  useCauHinhLuoi,
  ngayVN,
  type CotLuoi,
  type MauTT,
} from "../components/LuoiDs";
import { EmptyRow } from "../components/EmptyState";
import { trangHopLe } from "../components/Pager";
import { PhanTrangDayDu } from "../components/PhanTrangDayDu";
import {
  LOC_KHSX_TRONG,
  MOC_HANG_CHO,
  MOC_LENH_KHSX,
  locKhsxLenUrl,
  locKhsxSauKhiTao,
  locKhsxTuUrl,
  thamSoLocHangCho,
  thamSoLocLenhKhsx,
  useDieuKienHangCho,
  useDieuKienLenhKhsx,
  type LocHangCho,
  type LocKhsx,
  type LocLenhKhsx,
} from "./loc-san-xuat/dieu-kien-ke-hoach-sx";
import { ngayDayDu, ngayGioDayDu } from "./loc-san-xuat/ngay";
import { ThanhLoc } from "./thanh-loc/ThanhLoc";
import { thamSoKy, type KyDS } from "./thanh-loc/ky-danh-sach";
import { daAp, type DieuKien } from "./thanh-loc/thanh-loc";
import { useLocMan } from "./thanh-loc/useLocMan";
import { LsxDetailView } from "./LsxDetailView";
import { LsxPreviewDrawer } from "./LsxPreviewDrawer";
import { nhanDonVi } from "./lsxBuoc";
import { laTronGoi } from "./gia-cong/GiaCongDong";
import { NHAN_NGAN } from "./gia-cong/giaCong";
import { useNapTenDonVi } from "./tenDonVi";
import {
  BangLoi,
  TRANG_THAI_TABS,
  classHan,
  classHanLich,
  nhanTrangThaiLsx,
  ngayGio,
  num,
} from "./keHoachSxShared";

import "./ke-hoach-sx.css";

type View = { mode: "list" } | { mode: "detail"; id: number };

export function KeHoachSXPage({
  navigate,
  openOrderId,
  openLsxId,
  eventTick,
  dinhKemDem,
  onBadgeStale,
}: {
  navigate?: (id: string, params?: Record<string, unknown>) => void;
  /** Deep-link từ Đơn hàng: mở thẳng hàng chờ + drawer lệnh dự kiến của đơn này. */
  openOrderId?: number | null;
  /** Deep-link từ sơ đồ Bài ghép: mở thẳng chi tiết MỘT lệnh. */
  openLsxId?: number | null;
  /** Tăng mỗi lần có event SSE → refetch (real-time, không bắt người dùng F5). */
  eventTick?: number;
  /** Số lần tệp đính kèm đổi, đếm theo id lệnh — chỉ màn chi tiết đúng lệnh nạp lại danh sách tệp. */
  dinhKemDem?: Record<number, number>;
  onBadgeStale?: () => void;
}) {
  const { token } = useAuth();
  const can = useCan();
  const scopeOf = useScopeOf();
  const canCreate = can("san_xuat", "create");
  // Nhãn đơn vị đọc từ DANH MỤC — nạp một lần cho cả phiên (bảng lệnh + drawer lệnh dự kiến).
  useNapTenDonVi();

  const [view, setView] = useState<View>({ mode: "list" });
  // Tab "Vật tư" ĐÃ TÁCH 17/08/2026 thành màn riêng `Kế hoạch vật tư` (chủ chốt) — xem
  // `KeHoachVatTuPage`. Màn này giữ đúng phạm vi MỘT lệnh; bảng cân đối cả kho là việc của màn kia.
  const [tab, setTab] = useState<"hang-cho" | "lenh">("hang-cho");
  const [previewOrderId, setPreviewOrderId] = useState<number | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const [queue, setQueue] = useState<HangChoItem[] | null>(null);
  const [lenhs, setLenhs] = useState<LsxListItem[] | null>(null);
  const [ttFilter, setTtFilter] = useState("all");
  const [q, setQ] = useState("");
  // Thanh lọc (kỳ + điều kiện) của HAI bảng — ghi lên URL, nhớ theo màn (06/10/2026).
  const [locMan, setLocMan] = useLocMan<LocKhsx>("ke-hoach-sx", LOC_KHSX_TRONG, locKhsxTuUrl, locKhsxLenUrl);
  // Nạp lại danh sách khách/đơn của ô lọc khi có sự kiện hay vừa tạo lệnh (đơn mới mới có để chọn).
  const [nguonTick, setNguonTick] = useState(0);
  const dkLenh = useDieuKienLenhKhsx((eventTick ?? 0) + nguonTick, locMan.lenh.loc);
  const dkCho = useDieuKienHangCho((eventTick ?? 0) + nguonTick);
  const khoaLenh = JSON.stringify({ ...thamSoKy(locMan.lenh.ky), ...thamSoLocLenhKhsx(locMan.lenh.loc) });
  const khoaCho = JSON.stringify({ ...thamSoKy(locMan.cho.ky), ...thamSoLocHangCho(locMan.cho.loc) });
  const [err, setErr] = useState<string | null>(null);
  // Phân trang + số trên tab đều do MÁY CHỦ trả. Đếm bằng `lenhs.length` như trước chỉ đúng khi
  // cả bảng nằm gọn trong một lượt tải — có phân trang là số đó thành số của TRANG, sai ngay.
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [facets, setFacets] = useState<Record<string, number>>({});
  const [queuePage, setQueuePage] = useState(1);
  const [queueTotal, setQueueTotal] = useState(0);
  // Dòng/trang dùng CHUNG cho cả hai bảng của màn: cùng một chỗ giữ cho chân trang và tham số
  // gửi lên không lệch nhau. Đổi cỡ ⇒ cả hai bảng về trang 1.
  const [sizeTrang, setSizeTrang] = useState(25);
  const doiSizeTrang = (n: number) => {
    setSizeTrang(n);
    setPage(1);
    setQueuePage(1);
  };
  // Hàng đèn tiến độ (Đợt 1 redesign 18/08/2026) — GỌI RỜI sau bảng lệnh, không nhét vào
  // `/api/lsx`: endpoint tổng quan chạy engine cân đối vật tư + bộ dò vấn đề, còn bảng lệnh phải
  // hiện ngay. `denTick` để các hành động khác (tạo lệnh, đổi routing, giữ chỗ) bắt đèn tính lại —
  // bộ lọc/ô tìm KHÔNG bắt, vì khoá dưới đây chỉ đổi khi TẬP lệnh đổi.
  const [tq, setTq] = useState<Record<number, LsxTongQuanOut["items"][number]>>({});
  const [denTick, setDenTick] = useState(0);

  const loadQueue = useCallback(() => {
    if (!token) return;
    api.lsx
      .hangCho(token, { page: queuePage, size: sizeTrang, loc: JSON.parse(khoaCho) })
      .then((r) => {
        setErr(null);
        setQueue(r.items);
        setQueueTotal(r.total);
        const ve = trangHopLe(queuePage, r.total, sizeTrang);
        if (ve) setQueuePage(ve);
      })
      .catch((e: unknown) => setErr(e instanceof ApiError ? e.message : String(e)));
  }, [token, queuePage, sizeTrang, khoaCho]);

  // Số thứ tự lượt tải bảng lệnh. Không có nó thì một lượt gọi CŨ về muộn sẽ ghi đè kết quả
  // mới: bấm "Tạo lệnh" xong màn đặt lọc theo đơn vừa tạo, nhưng lượt tải không-lọc bắn trước đó
  // về sau và trả lại cả bảng — chip "Đơn DHxxx" vẫn sáng mà dưới là lệnh của mọi đơn.
  const luotLenh = useRef(0);
  const loadLenhs = useCallback(() => {
    if (!token) return;
    const luot = ++luotLenh.current;
    api.lsx
      .list(token, {
        trang_thai: ttFilter === "all" ? undefined : ttFilter,
        q: q.trim() || undefined,
        page,
        size: sizeTrang,
        // Kỳ + Khách / Đơn / Gia công ngoài của thanh lọc.
        loc: JSON.parse(khoaLenh),
      })
      .then((r) => {
        if (luot !== luotLenh.current) return;   // đã có lượt mới hơn — bỏ kết quả này
        setErr(null);
        setLenhs(r.items);
        setTotal(r.total);
        setFacets(r.facets);
        // Xoá nốt dòng cuối của trang 3 ⇒ còn 2 trang: không kéo về thì màn trắng trơn.
        const ve = trangHopLe(page, r.total, sizeTrang);
        if (ve) setPage(ve);
      })
      .catch((e: unknown) => {
        if (luot !== luotLenh.current) return;
        setErr(e instanceof ApiError ? e.message : String(e));
      });
  }, [token, ttFilter, q, page, sizeTrang, khoaLenh]);

  // Đổi bộ lọc thì về trang 1 — giữ nguyên trang cũ là rơi vào vùng trống của kết quả mới.
  useEffect(() => setPage(1), [ttFilter, q, khoaLenh]);
  useEffect(() => setQueuePage(1), [khoaCho]);

  useEffect(() => loadQueue(), [loadQueue, eventTick]);
  useEffect(() => {
    const t = setTimeout(loadLenhs, q ? 250 : 0);   // debounce ô tìm
    return () => clearTimeout(t);
  }, [loadLenhs, eventTick, q]);

  // Hỏi tổng quan cho MỌI lệnh đang hiện — bảng chỉ còn dùng `slack_ngay` tô ô Hạn SX (cột
  // "Vướng" đã gỡ 06/10/2026). Một lượt `tong_quan` là chi phí gần như không đổi theo số lệnh.
  const khoaDen = (lenhs ?? []).map((l) => l.id).join(",");
  useEffect(() => {
    if (!token || !khoaDen) {
      setTq({});
      return;
    }
    let huy = false;
    api.lsx
      .tongQuan(token, khoaDen.split(",").map(Number))
      .then((r) => {
        if (!huy) setTq(Object.fromEntries(r.items.map((i) => [i.lsx_id, i])));
      })
      // Đèn hỏng thì bảng lệnh vẫn phải dùng được — ô đèn để trống, KHÔNG chặn cả màn bằng `err`.
      .catch(() => {
        if (!huy) setTq({});
      });
    return () => {
      huy = true;
    };
  }, [token, khoaDen, eventTick, denTick]);

  // Deep-link từ màn Đơn hàng ("Mở bàn Kế hoạch sản xuất ↗").
  useEffect(() => {
    if (openOrderId) {
      setView({ mode: "list" });
      setTab("hang-cho");
      setPreviewOrderId(openOrderId);
    }
  }, [openOrderId]);

  useEffect(() => {
    if (openLsxId) setView({ mode: "detail", id: openLsxId });
  }, [openLsxId]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 5000);
    return () => clearTimeout(t);
  }, [flash]);

  function sauKhiTao(orderId: number, maList: string[], orderNo?: string) {
    setPreviewOrderId(null);
    // Sang bảng lệnh, lọc đúng đơn vừa tạo; kỳ về "Tất cả" (giữ mốc) để kỳ cũ không giấu lệnh mới.
    // Ghi kèm mã đơn: thẻ lọc không tra được mã từ danh sách đơn khi đơn hết lệnh (E2E #17).
    setLocMan(locKhsxSauKhiTao(locMan, orderId, orderNo));
    setNguonTick((n) => n + 1);
    setTab("lenh");
    if (maList.length) setFlash(`Đã tạo ${maList.length} lệnh: ${maList.join(", ")}`);
    loadQueue();
    // KHÔNG gọi `loadLenhs()` ở đây: hàm đang cầm là bản của lần render TRƯỚC, tức chưa biết
    // lọc đơn vừa đặt ⇒ nó hỏi cả bảng. Đặt lọc xong effect tự chạy lượt ĐÚNG; số thứ tự
    // lượt trong `loadLenhs` lo nốt trường hợp lượt cũ về muộn.
    onBadgeStale?.();
  }

  const doiDuLieu = useCallback(() => {
    loadQueue();
    loadLenhs();
    // Tập lệnh có thể KHÔNG đổi sau một lần sửa routing/giữ chỗ ⇒ `khoaDen` đứng yên ⇒ effect trên
    // không chạy lại. Tick thẳng để đèn không nói chuyện cũ.
    setDenTick((n) => n + 1);
    onBadgeStale?.();
  }, [loadQueue, loadLenhs, onBadgeStale]);

  if (view.mode === "detail") {
    return (
      <main className="khsx">
        <LsxDetailView
          lsxId={view.id}
          navigate={navigate}
          onBack={() => setView({ mode: "list" })}
          onChanged={doiDuLieu}
          eventTick={eventTick}
          dinhKemTick={dinhKemDem?.[view.id] ?? 0}
        />
      </main>
    );
  }

  // Số trên hàng lọc nhanh lấy từ `facets` của máy chủ, KHÔNG đếm mảng đang hiện. Mục gộp nhiều
  // trạng thái (Nháp = "nhap,cho_bo_sung") thì cộng các phần.
  const demTheoTt = (key: string) =>
    key === "all"
      ? (facets.all ?? 0)
      : key.split(",").reduce((s, k) => s + (facets[k] ?? 0), 0);

  return (
    <main className="khsx lds">
      <header className="lds-dau">
        <h1 className="lds-dau__ten">Kế hoạch sản xuất</h1>
        {/* Hai tab thật (đổi cả bảng bên dưới), đặt cạnh tên màn. Tab không mang số đếm: hàng chờ có
            đơn thì một chấm nhỏ, số đơn nằm ở chân bảng. */}
        <div className="khsx-tabman" role="tablist" aria-label="Khu vực làm việc">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "hang-cho"}
            className={`khsx-tabman__btn${tab === "hang-cho" ? " is-active" : ""}`}
            onClick={() => setTab("hang-cho")}
          >
            Hàng chờ tiếp nhận
            {queueTotal > 0 && <span className="khsx-tabman__cham" aria-label="Có đơn đang chờ lên lệnh" />}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "lenh"}
            className={`khsx-tabman__btn${tab === "lenh" ? " is-active" : ""}`}
            onClick={() => setTab("lenh")}
          >
            Lệnh sản xuất
          </button>
        </div>
      </header>

      {flash && (
        <div className="banner banner--success" role="status" aria-live="polite">
          {flash}
        </div>
      )}
      {/* Lượt nạp ĐẦU lỗi (bảng chưa có dòng nào) thì câu lỗi + "Thử lại" nằm ngay trong dòng rỗng của
          lưới; băng này chỉ cho lỗi xảy ra khi bảng đã có dòng. */}
      {err && (tab === "hang-cho" ? queue !== null : lenhs !== null) && <BangLoi text={err} onRetry={doiDuLieu} />}

      {tab === "hang-cho" ? (
        <QueueTable
          rows={queue}
          loi={err}
          onTaiLai={doiDuLieu}
          scopeAll={scopeOf("san_xuat") === "all"}
          onOpen={(id) => setPreviewOrderId(id)}
          dangMo={previewOrderId}
          total={queueTotal}
          page={queuePage}
          size={sizeTrang}
          onPage={setQueuePage}
          onSize={doiSizeTrang}
          ky={locMan.cho.ky}
          onKy={(ky) => setLocMan({ ...locMan, cho: { ...locMan.cho, ky } })}
          dieuKien={dkCho}
          loc={locMan.cho.loc}
          onLoc={(loc) => setLocMan({ ...locMan, cho: { ...locMan.cho, loc } })}
          onXoaLoc={() => setLocMan({ ...locMan, cho: { ky: { loai: "tat_ca", moc: locMan.cho.ky.moc }, loc: {} } })}
        />
      ) : (
        <LenhTable
          rows={lenhs}
          loi={err}
          onTaiLai={doiDuLieu}
          ttFilter={ttFilter}
          onTtFilter={setTtFilter}
          q={q}
          onQ={setQ}
          ky={locMan.lenh.ky}
          onKy={(ky) => setLocMan({ ...locMan, lenh: { ...locMan.lenh, ky } })}
          dieuKien={dkLenh}
          loc={locMan.lenh.loc}
          onLoc={(loc) => setLocMan({ ...locMan, lenh: { ...locMan.lenh, loc } })}
          onXoaLoc={() => setLocMan({ ...locMan, lenh: { ky: { loai: "tat_ca", moc: locMan.lenh.ky.moc }, loc: {} } })}
          onOpen={(id) => setView({ mode: "detail", id })}
          onGoQueue={() => setTab("hang-cho")}
          tq={tq}
          dem={demTheoTt}
          total={total}
          page={page}
          size={sizeTrang}
          onPage={setPage}
          onSize={doiSizeTrang}
        />
      )}

      {previewOrderId != null && (
        <LsxPreviewDrawer
          orderId={previewOrderId}
          canCreate={canCreate}
          onClose={() => setPreviewOrderId(null)}
          onCreated={sauKhiTao}
          onOpenLsx={(id) => {
            setPreviewOrderId(null);
            setView({ mode: "detail", id });
          }}
        />
      )}
    </main>
  );
}

// --- Lưới danh sách (khuôn chung lds, 08/10/2026) ----------------------------
// Thứ tự cột theo nhóm nghĩa: Mã, các ngày, Khách, Hàng, Số lượng, Trạng thái, khâu, Người, Ghi chú.
interface CotKh extends CotLuoi {
  w?: number;
  n?: boolean;
}

/** Chip "Gấp" cạnh mã — thay khối đỏ có chuông của bảng cũ. */
function ChipGapLuoi() {
  return (
    <span className="khsx-cach">
      <ChipTT mau="do" vuong title="Đơn / lệnh gấp">Gấp</ChipTT>
    </span>
  );
}

/** Hạn quá/sắp tới: dùng màu chữ của lưới (đỏ / vàng), không in đậm. */
function lopHan(cls: string): string | undefined {
  return cls === "khsx-date--late" ? "lds-do" : cls === "khsx-date--soon" ? "lds-vang" : undefined;
}

// --- Tab 1: hàng chờ tiếp nhận ----------------------------------------------
const COT_CHO: CotKh[] = [
  { key: "ma", label: "Mã đơn", coDinh: true, w: 150 },
  { key: "tao", label: "Ngày tạo", w: 104 },
  { key: "chuyen", label: "Chuyển lúc", w: 140 },
  { key: "giao", label: "Ngày giao", w: 104 },
  { key: "khach", label: "Khách hàng", w: 200 },
  { key: "sp", label: "Sản phẩm / Hạng mục", w: 250 },
  { key: "tiendo", label: "Tiến độ lệnh", w: 120 },
  { key: "sale", label: "Sale", w: 140 },
  { key: "luuy", label: "Lưu ý sản xuất" },
];

function OCho({ cot, o }: { cot: string; o: HangChoItem }) {
  switch (cot) {
    case "ma":
      return (
        <td>
          {o.order_no}
          {o.is_rush && <ChipGapLuoi />}
        </td>
      );
    case "tao":
      return <td title={ngayGioDayDu(o.created_at)}>{ngayDayDu(o.created_at)}</td>;
    case "chuyen":
      return <td>{ngayGio(o.san_xuat_released_at)}</td>;
    case "giao":
      return (
        <td>
          <span className={lopHan(classHan(o.delivery_committed_date))}>{ngayVN(o.delivery_committed_date)}</span>
        </td>
      );
    case "khach":
      return o.customer_name ? (
        <td title={o.customer_name}>{tenKhachGon(o.customer_name)}</td>
      ) : (
        <td>
          <span className="lds-mu3">—</span>
        </td>
      );
    case "sp": {
      const muc = o.san_pham_tom_tat ? o.san_pham_tom_tat.split(", ").filter(Boolean) : [];
      return (
        <td title={o.san_pham_tom_tat ?? undefined}>
          {muc.length > 0 ? muc[0] : <span className="lds-mu">{o.so_dong} hạng mục</span>}
          {muc.length > 1 ? <span className="lds-tag">+{muc.length - 1}</span> : null}
        </td>
      );
    }
    case "tiendo": {
      const xong = o.so_dong > 0 && o.so_dong_co_lsx === o.so_dong;
      return (
        <td>
          <ChipTT mau={xong ? "la" : "cam"} vuong>
            {o.so_dong_co_lsx}/{o.so_dong} dòng
          </ChipTT>
        </td>
      );
    }
    case "sale":
      return o.sale_name ? <td title={o.sale_name}>{o.sale_name}</td> : <td><span className="lds-mu3">—</span></td>;
    case "luuy":
      return o.production_note ? <td title={o.production_note}>{o.production_note}</td> : <td><span className="lds-mu3">—</span></td>;
    default:
      return <td />;
  }
}

function QueueTable({
  rows,
  loi,
  onTaiLai,
  scopeAll,
  onOpen,
  dangMo,
  total,
  page,
  size,
  onPage,
  onSize,
  ky,
  onKy,
  dieuKien,
  loc,
  onLoc,
  onXoaLoc,
}: {
  rows: HangChoItem[] | null;
  /** Lỗi nạp; chỉ vẽ trong dòng rỗng khi `rows === null` (chưa có lượt nạp nào thành công). */
  loi: string | null;
  onTaiLai: () => void;
  scopeAll: boolean;
  onOpen: (orderId: number) => void;
  /** Đơn đang mở ngăn "lệnh dự kiến" — dòng đó viền đủ cạnh. */
  dangMo: number | null;
  /** TỔNG đơn chờ trên máy chủ (≠ `rows.length`, vốn chỉ là trang đang xem). */
  total: number;
  page: number;
  size: number;
  onPage: (p: number) => void;
  onSize: (n: number) => void;
  ky: KyDS;
  onKy: (k: KyDS) => void;
  dieuKien: DieuKien<LocHangCho>[];
  loc: LocHangCho;
  onLoc: (l: LocHangCho) => void;
  /** Kỳ về "Tất cả" + bỏ mọi điều kiện — MỘT lần ghi (hai lần ghi rời thì lần sau đè lần trước). */
  onXoaLoc: () => void;
}) {
  const luoi = useCauHinhLuoi("khsx-hang-cho");
  const cotHien = luoi.rongHien(luoi.xep(COT_CHO).filter((c) => !luoi.an.has(c.key)));
  const coLoc = ky.loai !== "tat_ca" || dieuKien.some((d) => daAp(d, loc));
  return (
    <>
      <section className="lds-loc">
        <div className="lds-loc__thanh tl-thanh" role="search">
          <ThanhLoc ky={ky} moc={MOC_HANG_CHO} onKy={onKy} dieuKien={dieuKien} loc={loc} onLoc={onLoc} />
          <ChonCot cot={COT_CHO} {...luoi.chonCot} />
        </div>
      </section>
      <div className="lds-sheet">
        <CuonLuoi ghim={luoi.soGhim(cotHien)}>
          <table className="lds-g" style={{ minWidth: rongLuoi(cotHien) }}>
            <caption className="sr-only">Đơn hàng đã chuyển xuống sản xuất, chờ lên lệnh</caption>
            <colgroup>
              {cotHien.map((c) => (
                <col key={c.key} style={c.w ? { width: c.w } : undefined} />
              ))}
            </colgroup>
            <thead>
              <tr>
                {cotHien.map((c) => (
                  <th key={c.key} className={c.n ? "n" : undefined}>
                    {c.label}
                    {luoi.keo(c.key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows === null && loi ? (
                <tr>
                  <td colSpan={cotHien.length} className="lds-trong">
                    <span role="alert" className="lds-do">{loi}</span>{" "}
                    <button type="button" className="lds-lk" onClick={onTaiLai}>Thử lại</button>
                  </td>
                </tr>
              ) : rows === null ? (
                <EmptyRow colSpan={cotHien.length} trangThai="dang-tai" />
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={cotHien.length} className="lds-trong">
                    {coLoc ? (
                      <>
                        Không có đơn chờ nào khớp điều kiện đang lọc.{" "}
                        <button type="button" className="lds-lk" onClick={onXoaLoc}>
                          Xoá bộ lọc
                        </button>
                      </>
                    ) : scopeAll ? (
                      "Không có đơn nào chờ lên lệnh. Đơn đã chốt và đủ cọc tự hiện ở đây ngay, không cần tải lại trang."
                    ) : (
                      "Không có đơn nào của bạn chờ lên lệnh. Đơn đã chốt và đủ cọc tự hiện ở đây ngay, không cần tải lại trang."
                    )}
                  </td>
                </tr>
              ) : (
                rows.map((o) => (
                  <tr
                    key={o.order_id}
                    className={`lds-dong${o.order_id === dangMo ? " is-chon" : ""}`}
                    tabIndex={0}
                    aria-label={`Xem lệnh dự kiến của đơn ${o.order_no}`}
                    onClick={() => onOpen(o.order_id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onOpen(o.order_id);
                      }
                    }}
                  >
                    {cotHien.map((c) => (
                      <OCho key={c.key} cot={c.key} o={o} />
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CuonLuoi>
        {total > 0 && (
          <PhanTrangDayDu
            trang={page}
            size={size}
            tong={total}
            soDong={rows?.length ?? 0}
            onTrang={onPage}
            onSize={onSize}
            loading={rows === null}
            donVi="đơn chờ"
            ariaLabel="Phân trang đơn chờ lên lệnh"
          />
        )}
      </div>
    </>
  );
}

// --- Tab 2: danh sách lệnh ---------------------------------------------------
const COT_LENH: CotKh[] = [
  { key: "ma", label: "Mã lệnh", coDinh: true, w: 150 },
  { key: "tao", label: "Ngày tạo", w: 104 },
  { key: "hansx", label: "Hạn sản xuất", w: 112 },
  { key: "hangiao", label: "Hạn giao", w: 104 },
  { key: "don", label: "Đơn hàng", w: 110 },
  { key: "khach", label: "Khách hàng", w: 190 },
  { key: "sp", label: "Sản phẩm / Bộ phận", w: 240 },
  { key: "sl", label: "Số lượng", w: 110, n: true },
  { key: "tt", label: "Trạng thái", w: 140 },
  { key: "cd", label: "Công đoạn" },
];

// Chip trạng thái lệnh: mỗi trạng thái MỘT sắc (bộ --tt-*), hàng lọc nhanh dùng cùng sắc cho chấm.
const MAU_TT_LENH: Record<LsxTrangThai, MauTT> = {
  nhap: "slate",
  cho_bo_sung: "slate",
  san_sang: "cyan",
  da_lap_ke_hoach: "xanh",
  da_phat_hanh: "la",
  da_dong: "xam",
};
const MAU_LOC_LENH: Record<string, MauTT | undefined> = { "nhap,cho_bo_sung": "slate", san_sang: "cyan" };

const conMoGc = (g: LsxListGiaCong) => g.trang_thai !== "da_xong";

function OLenh({
  cot,
  l,
  tq,
}: {
  cot: string;
  l: LsxListItem;
  tq: Record<number, LsxTongQuanOut["items"][number]>;
}) {
  switch (cot) {
    case "ma":
      return (
        <td>
          {l.ma}
          {l.is_rush && <ChipGapLuoi />}
        </td>
      );
    case "tao":
      return <td title={ngayGioDayDu(l.created_at)}>{ngayDayDu(l.created_at)}</td>;
    case "hansx": {
      const slack = tq[l.id]?.slack_ngay;
      return (
        <td
          title={
            slack != null
              ? slack < 0
                ? `Lịch đang vượt hạn ${-slack} ngày làm việc`
                : `Lịch còn dư ${slack} ngày làm việc`
              : undefined
          }
        >
          <span className={lopHan(classHanLich(slack, l.han_hoan_thanh_sx))}>{ngayVN(l.han_hoan_thanh_sx)}</span>
        </td>
      );
    }
    case "hangiao":
      return <td>{ngayVN(l.han_giao_khach)}</td>;
    case "don":
      return l.order_no ? <td title={l.order_no}>{l.order_no}</td> : <td><span className="lds-mu3">—</span></td>;
    case "khach":
      return l.customer_name ? (
        <td title={l.customer_name}>{tenKhachGon(l.customer_name)}</td>
      ) : (
        <td>
          <span className="lds-mu3">—</span>
        </td>
      );
    case "sp":
      return (
        <td title={l.nhom ? `${l.nhom} — ${l.ten}` : l.ten}>
          {l.ten}
          {l.nhom ? <span className="lds-tag">{l.nhom}</span> : null}
        </td>
      );
    case "sl":
      return (
        <td className="n">
          {num(l.so_luong_dat)}
          <span className="lds-u">{nhanDonVi(l.don_vi_tinh)}</span>
        </td>
      );
    case "tt":
      return (
        <td>
          {laTronGoi(l.gia_cong) && l.trang_thai === "da_phat_hanh" ? (
            <ChipTT
              mau={conMoGc(l.gia_cong) ? "vang" : "ngoc"}
              title="Lệnh đã giao trọn gói cho nhà gia công, không xuống xưởng"
            >
              {conMoGc(l.gia_cong) ? "Ở nhà gia công" : "Đã nhận về"}
            </ChipTT>
          ) : (
            <ChipTT mau={MAU_TT_LENH[l.trang_thai] ?? "slate"}>{nhanTrangThaiLsx(l.trang_thai)}</ChipTT>
          )}
        </td>
      );
    case "cd": {
      const g = l.gia_cong;
      // Kiểm `kieu` trực tiếp (cùng điều kiện với `laTronGoi`) chứ không gọi type guard: guard
      // `g is LsxListGiaCong` ở nhánh sai thu `g` về null/undefined, rồi `g && conMoGc(g)` thành `never`.
      if (g?.kieu === "tron_goi") {
        // Trọn gói: lệnh không xuống tổ — "6 bước / Cắt 2" ở đây là nói sai chỗ.
        return (
          <td
            title={`${g.nha_cung_cap_ten}${g.cho_cap_giay ? "\nChờ cấp giấy: mở lệnh, bấm “Chọn giấy” ở khối Gia công ngoài" : ""}`}
          >
            <ChipTT mau={conMoGc(g) ? "ngoc" : "la"} vuong>
              Gia công trọn gói
            </ChipTT>
            <span className="lds-u">{g.nha_cung_cap_ten}</span>
            {g.cho_cap_giay ? <span className="lds-u lds-vang">Chờ cấp giấy</span> : null}
          </td>
        );
      }
      const tieuDeGc = g && conMoGc(g)
        ? [
            `${g.ten_viec} ở ${g.nha_cung_cap_ten}${g.so_lan_mo > 1 ? ` và ${g.so_lan_mo - 1} lần khác` : ""}`,
            g.bai_ghep_ma ? `Đi chung bài ghép ${g.bai_ghep_ma}` : null,
          ].filter(Boolean).join("\n")
        : undefined;
      return (
        <td title={tieuDeGc ?? (l.to_dau_ten ? `Tổ xuất phát: ${l.to_dau_ten}` : undefined)}>
          {/* Chip gia công đứng ĐẦU ô: ô hẹp thì dấu ba chấm cắt "N bước" chứ không nuốt chip (11/10/2026). */}
          {g && conMoGc(g) ? (
            <span className="khsx-cach-sau">
              <ChipTT mau={g.trang_thai === "cho_mang_di" ? "cham" : "ngoc"} vuong>
                {g.ten_viec} {NHAN_NGAN[g.trang_thai]}
              </ChipTT>
            </span>
          ) : null}
          {l.so_cong_doan > 0 ? (
            <>
              {l.so_cong_doan} bước
              {l.to_dau_ten ? <span className="lds-u">{l.to_dau_ten}</span> : null}
            </>
          ) : (
            <ChipTT mau="do" vuong>
              Chưa có công đoạn
            </ChipTT>
          )}
        </td>
      );
    }
    default:
      return <td />;
  }
}

function LenhTable({
  rows,
  loi,
  onTaiLai,
  ttFilter,
  onTtFilter,
  q,
  onQ,
  ky,
  onKy,
  dieuKien,
  loc,
  onLoc,
  onXoaLoc,
  onOpen,
  onGoQueue,
  tq,
  dem,
  total,
  page,
  size,
  onPage,
  onSize,
}: {
  rows: LsxListItem[] | null;
  /** Lỗi nạp; chỉ vẽ trong dòng rỗng khi `rows === null` (chưa có lượt nạp nào thành công). */
  loi: string | null;
  onTaiLai: () => void;
  ttFilter: string;
  onTtFilter: (k: string) => void;
  q: string;
  onQ: (v: string) => void;
  ky: KyDS;
  onKy: (k: KyDS) => void;
  dieuKien: DieuKien<LocLenhKhsx>[];
  loc: LocLenhKhsx;
  onLoc: (l: LocLenhKhsx) => void;
  onXoaLoc: () => void;
  /** TỔNG lệnh khớp bộ lọc trên máy chủ. */
  total: number;
  page: number;
  size: number;
  onPage: (p: number) => void;
  onSize: (n: number) => void;
  onOpen: (id: number) => void;
  onGoQueue: () => void;
  /** Tổng quan theo lsx_id (bảng chỉ dùng `slack_ngay` tô ô hạn) — tải RỜI sau bảng. */
  tq: Record<number, LsxTongQuanOut["items"][number]>;
  dem: (key: string) => number;
}) {
  const luoi = useCauHinhLuoi("khsx-lenh");
  const cotHien = luoi.rongHien(luoi.xep(COT_LENH).filter((c) => !luoi.an.has(c.key)));
  const coLoc = ttFilter !== "all" || q.trim() !== "" || ky.loai !== "tat_ca"
    || dieuKien.some((d) => daAp(d, loc));
  // Số trên hàng lọc nhanh lấy từ `facets` của máy chủ (qua `dem`), cùng bộ lọc trừ trạng thái.
  const muc = TRANG_THAI_TABS.map((t) => ({ key: t.key, label: t.label, count: dem(t.key), mau: MAU_LOC_LENH[t.key] }));
  return (
    <>
      <section className="lds-loc">
        <LocNhanhTrangThai muc={muc} dang={ttFilter} onChon={onTtFilter} />
        <div className="lds-loc__thanh tl-thanh" role="search">
          <OTim
            value={q}
            onChange={onQ}
            placeholder="Tìm mã lệnh, mã đơn, tên sản phẩm"
            ariaLabel="Tìm lệnh sản xuất"
          />
          <ThanhLoc ky={ky} moc={MOC_LENH_KHSX} onKy={onKy} dieuKien={dieuKien} loc={loc} onLoc={onLoc} />
          <ChonCot cot={COT_LENH} {...luoi.chonCot} />
        </div>
      </section>
      <div className="lds-sheet">
        <CuonLuoi ghim={luoi.soGhim(cotHien)}>
          <table className="lds-g" style={{ minWidth: rongLuoi(cotHien) }}>
            <caption className="sr-only">Danh sách lệnh sản xuất</caption>
            <colgroup>
              {cotHien.map((c) => (
                <col key={c.key} style={c.w ? { width: c.w } : undefined} />
              ))}
            </colgroup>
            <thead>
              <tr>
                {cotHien.map((c) => (
                  <th key={c.key} className={c.n ? "n" : undefined}>
                    {c.label}
                    {luoi.keo(c.key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows === null && loi ? (
                <tr>
                  <td colSpan={cotHien.length} className="lds-trong">
                    <span role="alert" className="lds-do">{loi}</span>{" "}
                    <button type="button" className="lds-lk" onClick={onTaiLai}>Thử lại</button>
                  </td>
                </tr>
              ) : rows === null ? (
                <EmptyRow colSpan={cotHien.length} trangThai="dang-tai" />
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={cotHien.length} className="lds-trong">
                    {coLoc ? (
                      <>
                        Không có lệnh nào khớp điều kiện đang lọc.{" "}
                        <button
                          type="button"
                          className="lds-lk"
                          onClick={() => {
                            onTtFilter("all");
                            onQ("");
                            // `coLoc` tính cả kỳ lẫn mọi điều kiện — sót một cái là bấm xong vẫn rỗng.
                            onXoaLoc();
                          }}
                        >
                          Xoá bộ lọc
                        </button>
                      </>
                    ) : (
                      <>
                        Chưa có lệnh sản xuất nào. Lệnh sinh ra từ đơn Sale đã chuyển xuống sản xuất.{" "}
                        <button type="button" className="lds-lk" onClick={onGoQueue}>
                          Sang Hàng chờ →
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ) : (
                rows.map((l) => (
                  <tr
                    key={l.id}
                    className="lds-dong"
                    tabIndex={0}
                    aria-label={`Mở lệnh ${l.ma}`}
                    onClick={() => onOpen(l.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onOpen(l.id);
                      }
                    }}
                  >
                    {cotHien.map((c) => (
                      <OLenh key={c.key} cot={c.key} l={l} tq={tq} />
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CuonLuoi>
        {total > 0 && (
          <PhanTrangDayDu
            trang={page}
            size={size}
            tong={total}
            soDong={rows?.length ?? 0}
            onTrang={onPage}
            onSize={onSize}
            loading={rows === null}
            donVi="lệnh"
            ariaLabel="Phân trang lệnh sản xuất"
          />
        )}
      </div>
    </>
  );
}
