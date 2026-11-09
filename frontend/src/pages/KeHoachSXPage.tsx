// BÀN KẾ HOẠCH SẢN XUẤT — controller master↔detail (không react-router, điều hướng bằng state).
//
// Luồng (08/11/2026): Sale bấm "Chuyển xuống sản xuất" ở Đơn hàng → đơn rơi vào tab HÀNG CHỜ TIẾP NHẬN
// (real-time qua SSE, `eventTick` đổi → refetch) → người có ô Giao đơn tick rồi giao cho người phụ
// trách → đơn sang tab TẠO LỆNH của người đó → mở đơn xem DANH SÁCH LỆNH DỰ KIẾN → tick → tạo lệnh →
// sang tab LỆNH SẢN XUẤT sửa routing/số lượng → đánh dấu "Sẵn sàng lập kế hoạch".
//
// Lát này DỪNG ở trạng thái "sẵn sàng": chưa ghép bài, chưa xếp lịch, chưa phát xuống xưởng.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError,
  api,
  type CheDoCho,
  type HangChoItem,
  type LsxListGiaCong,
  type LsxListItem,
  type LsxTrangThai,
  type TrangThaiCho,
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
import { HopGiaoDon } from "./HopGiaoDon";
import { nhanDonVi } from "./lsxBuoc";
import { laTronGoi } from "./gia-cong/GiaCongDong";
import { NHAN_NGAN } from "./gia-cong/giaCong";
import { useNapTenDonVi } from "./tenDonVi";
import {
  BangLoi,
  TRANG_THAI_TABS,
  classHan,
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
  // Ô "Giao đơn" (08/11/2026): chỉ người có ô này thấy tab Hàng chờ tiếp nhận.
  const laNguoiGiao = can("san_xuat", "reassign");
  // Nhãn đơn vị đọc từ DANH MỤC — nạp một lần cho cả phiên (bảng lệnh + drawer lệnh dự kiến).
  useNapTenDonVi();

  const [view, setView] = useState<View>({ mode: "list" });
  // Tab "Vật tư" ĐÃ TÁCH 17/08/2026 thành màn riêng `Kế hoạch vật tư` (chủ chốt) — xem
  // `KeHoachVatTuPage`. Màn này giữ đúng phạm vi MỘT lệnh; bảng cân đối cả kho là việc của màn kia.
  const [tabChon, setTab] = useState<"hang-cho" | "tao" | "lenh">(laNguoiGiao ? "hang-cho" : "tao");
  // Không có ô Giao đơn thì tab Hàng chờ tiếp nhận không có — rơi về Tạo lệnh.
  const tab = tabChon === "hang-cho" && !laNguoiGiao ? "tao" : tabChon;
  const cheDo: CheDoCho = tab === "hang-cho" ? "giao" : "tao";
  const [previewOrderId, setPreviewOrderId] = useState<number | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const [queue, setQueue] = useState<HangChoItem[] | null>(null);
  // Chip trạng thái của từng tab, số trên chip và chấm hai tab do MÁY CHỦ trả.
  const [ttCho, setTtCho] = useState<Record<CheDoCho, string>>({ giao: "tat_ca", tao: "tat_ca" });
  const ttHien = ttCho[cheDo];
  const [facetsCho, setFacetsCho] = useState<Record<string, number>>({});
  const [cham, setCham] = useState<{ giao: boolean; tao: boolean }>({ giao: false, tao: false });
  // Đơn đã tick — giữ cả dòng để hộp Giao biết đơn nào đang giao cho ai, kể cả khi đổi trang.
  const [chonCho, setChonCho] = useState<Map<number, HangChoItem>>(new Map());
  const [moGiao, setMoGiao] = useState(false);
  const [cuaToi, setCuaToi] = useState(false);
  const [lenhs, setLenhs] = useState<LsxListItem[] | null>(null);
  const [ttFilter, setTtFilter] = useState("all");
  const [q, setQ] = useState("");
  // Thanh lọc (kỳ + điều kiện) của BA bảng — ghi lên URL, nhớ theo màn (06/10/2026).
  const [locMan, setLocMan] = useLocMan<LocKhsx>("ke-hoach-sx", LOC_KHSX_TRONG, locKhsxTuUrl, locKhsxLenUrl);
  // Nạp lại danh sách khách/đơn của ô lọc khi có sự kiện hay vừa tạo lệnh (đơn mới mới có để chọn).
  const [nguonTick, setNguonTick] = useState(0);
  const dkLenh = useDieuKienLenhKhsx((eventTick ?? 0) + nguonTick, locMan.lenh.loc);
  const dkGiao = useDieuKienHangCho((eventTick ?? 0) + nguonTick, "giao", !laNguoiGiao);
  const dkTao = useDieuKienHangCho((eventTick ?? 0) + nguonTick, "tao");
  const khoaLocCho: "cho" | "tao" = cheDo === "giao" ? "cho" : "tao";
  const locCho = locMan[khoaLocCho];
  const khoaLenh = JSON.stringify({ ...thamSoKy(locMan.lenh.ky), ...thamSoLocLenhKhsx(locMan.lenh.loc) });
  const khoaCho = JSON.stringify({ ...thamSoKy(locCho.ky), ...thamSoLocHangCho(locCho.loc) });
  const [err, setErr] = useState<string | null>(null);
  // Phân trang + số trên tab đều do MÁY CHỦ trả. Đếm bằng `lenhs.length` như trước chỉ đúng khi
  // cả bảng nằm gọn trong một lượt tải — có phân trang là số đó thành số của TRANG, sai ngay.
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [facets, setFacets] = useState<Record<string, number>>({});
  const [queuePage, setQueuePage] = useState(1);
  const [queueTotal, setQueueTotal] = useState(0);
  // Dòng/trang dùng CHUNG cho các bảng của màn: cùng một chỗ giữ cho chân trang và tham số
  // gửi lên không lệch nhau. Đổi cỡ ⇒ các bảng về trang 1.
  const [sizeTrang, setSizeTrang] = useState(25);
  const doiSizeTrang = (n: number) => {
    setSizeTrang(n);
    setPage(1);
    setQueuePage(1);
  };

  // Chấm của hai tab, không theo thanh lọc — tab đang không mở vẫn biết có việc mới.
  const loadCham = useCallback(() => {
    if (!token) return;
    api.lsx.hangChoCham(token).then(setCham).catch(() => {});
  }, [token]);

  // Số thứ tự lượt tải bảng đơn: đổi tab giữa chừng thì lượt của tab cũ về muộn không được ghi đè.
  const luotCho = useRef(0);
  const loadQueue = useCallback(() => {
    if (!token || tab === "lenh") return;
    const luot = ++luotCho.current;
    api.lsx
      .hangCho(token, {
        page: queuePage,
        size: sizeTrang,
        loc: { ...JSON.parse(khoaCho), che_do: cheDo, trang_thai: ttHien === "tat_ca" ? undefined : ttHien },
      })
      .then((r) => {
        if (luot !== luotCho.current) return;
        setErr(null);
        setQueue(r.items);
        setQueueTotal(r.total);
        setFacetsCho(r.facets ?? {});
        setCham((c) => ({ ...c, [cheDo]: Boolean(r.cham) }));
        const ve = trangHopLe(queuePage, r.total, sizeTrang);
        if (ve) setQueuePage(ve);
      })
      .catch((e: unknown) => {
        if (luot !== luotCho.current) return;
        setErr(e instanceof ApiError ? e.message : String(e));
      });
  }, [token, tab, cheDo, queuePage, sizeTrang, khoaCho, ttHien]);

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
        // Kỳ + Khách / Đơn / Gia công ngoài của thanh lọc; chip "Của tôi" = lệnh mình phụ trách.
        loc: { ...JSON.parse(khoaLenh), cua_toi: cuaToi || undefined },
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
  }, [token, ttFilter, q, page, sizeTrang, khoaLenh, cuaToi]);

  // Đổi bộ lọc thì về trang 1 — giữ nguyên trang cũ là rơi vào vùng trống của kết quả mới.
  useEffect(() => setPage(1), [ttFilter, q, khoaLenh, cuaToi]);
  useEffect(() => setQueuePage(1), [khoaCho, ttHien, cheDo]);
  // Đổi tab đơn ⇒ bảng về trạng thái đang tải và bỏ các đơn đã tick của tab kia.
  useEffect(() => {
    setQueue(null);
    setChonCho(new Map());
  }, [cheDo]);

  useEffect(() => loadQueue(), [loadQueue, eventTick]);
  useEffect(() => loadCham(), [loadCham, eventTick]);
  // Hàng chờ nạp lại (người khác vừa giao, vừa tạo lệnh) ⇒ đơn đang tick lấy bản mới, để câu hỏi
  // "đang giao cho X" của hộp Giao nói đúng người đang giữ.
  useEffect(() => {
    if (!queue) return;
    setChonCho((m) => {
      if (m.size === 0) return m;
      const moi = new Map(m);
      for (const o of queue) if (moi.has(o.order_id)) moi.set(o.order_id, o);
      return moi;
    });
  }, [queue]);
  useEffect(() => {
    const t = setTimeout(loadLenhs, q ? 250 : 0);   // debounce ô tìm
    return () => clearTimeout(t);
  }, [loadLenhs, eventTick, q]);

  // Deep-link từ màn Đơn hàng ("Mở bàn Kế hoạch sản xuất ↗") — lệnh tạo ở tab Tạo lệnh.
  useEffect(() => {
    if (openOrderId) {
      setView({ mode: "list" });
      setTab("tao");
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
    loadCham();
    // KHÔNG gọi `loadLenhs()` ở đây: hàm đang cầm là bản của lần render TRƯỚC, tức chưa biết
    // lọc đơn vừa đặt ⇒ nó hỏi cả bảng. Đặt lọc xong effect tự chạy lượt ĐÚNG; số thứ tự
    // lượt trong `loadLenhs` lo nốt trường hợp lượt cũ về muộn.
    onBadgeStale?.();
  }

  const doiDuLieu = useCallback(() => {
    loadQueue();
    loadLenhs();
    loadCham();
    onBadgeStale?.();
  }, [loadQueue, loadLenhs, loadCham, onBadgeStale]);

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

  const nutTab = (key: "hang-cho" | "tao" | "lenh", nhan: string, chamTab?: string | false) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === key}
      className={`khsx-tabman__btn${tab === key ? " is-active" : ""}`}
      onClick={() => setTab(key)}
    >
      {nhan}
      {chamTab && <span className="khsx-tabman__cham" aria-label={chamTab} />}
    </button>
  );

  return (
    <main className="khsx lds">
      <header className="lds-dau">
        <h1 className="lds-dau__ten">Lệnh sản xuất</h1>
        {/* Ba tab thật (đổi cả bảng bên dưới), đặt cạnh tên màn. Tab không mang số đếm: có việc mới thì
            một chấm nhỏ, số đơn nằm ở chân bảng. */}
        <div className="khsx-tabman" role="tablist" aria-label="Khu vực làm việc">
          {laNguoiGiao && nutTab("hang-cho", "Hàng chờ tiếp nhận", cham.giao && "Còn đơn chưa giao")}
          {nutTab("tao", "Tạo lệnh", cham.tao && "Có đơn mới giao cho bạn")}
          {nutTab("lenh", "Lệnh sản xuất")}
        </div>
      </header>

      {flash && (
        <div className="banner banner--success" role="status" aria-live="polite">
          {flash}
        </div>
      )}
      {/* Lượt nạp ĐẦU lỗi (bảng chưa có dòng nào) thì câu lỗi + "Thử lại" nằm ngay trong dòng rỗng của
          lưới; băng này chỉ cho lỗi xảy ra khi bảng đã có dòng. */}
      {err && (tab !== "lenh" ? queue !== null : lenhs !== null) && <BangLoi text={err} onRetry={doiDuLieu} />}

      {tab !== "lenh" ? (
        <QueueTable
          key={cheDo}
          cheDo={cheDo}
          rows={queue}
          loi={err}
          onTaiLai={doiDuLieu}
          scope={scopeOf("san_xuat")}
          onOpen={(id) => {
            setPreviewOrderId(id);
            // Máy chủ tắt chấm "chưa mở" khi ngăn nạp; tắt ngay trên màn để khỏi chờ lượt nạp lại.
            setQueue((ds) => ds?.map((o) => (o.order_id === id ? { ...o, chua_mo: false } : o)) ?? ds);
          }}
          dangMo={previewOrderId}
          tt={ttHien}
          onTt={(k) => setTtCho((m) => ({ ...m, [cheDo]: k }))}
          facets={facetsCho}
          chon={chonCho}
          onChon={setChonCho}
          onGiao={() => setMoGiao(true)}
          total={queueTotal}
          page={queuePage}
          size={sizeTrang}
          onPage={setQueuePage}
          onSize={doiSizeTrang}
          ky={locCho.ky}
          onKy={(ky) => setLocMan({ ...locMan, [khoaLocCho]: { ...locCho, ky } })}
          dieuKien={cheDo === "giao" ? dkGiao : dkTao}
          loc={locCho.loc}
          onLoc={(loc) => setLocMan({ ...locMan, [khoaLocCho]: { ...locCho, loc } })}
          onXoaLoc={() => setLocMan({ ...locMan, [khoaLocCho]: { ky: { loai: "tat_ca", moc: locCho.ky.moc }, loc: {} } })}
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
          onGoTao={() => setTab("tao")}
          cuaToi={cuaToi}
          onCuaToi={setCuaToi}
          dem={demTheoTt}
          total={total}
          page={page}
          size={sizeTrang}
          onPage={setPage}
          onSize={doiSizeTrang}
        />
      )}

      {moGiao && (
        <HopGiaoDon
          don={[...chonCho.values()]}
          onDong={() => setMoGiao(false)}
          onXong={(kq) => {
            setMoGiao(false);
            setChonCho(new Map());
            const so = kq.da_giao.length + kq.giao_lai.length;
            setFlash(so > 0 ? `Đã giao ${so} đơn cho ${kq.nguoi_nhan_ten}` : `Các đơn đã ở chỗ ${kq.nguoi_nhan_ten}`);
            loadQueue();
            loadCham();
            setNguonTick((n) => n + 1);
            onBadgeStale?.();
          }}
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

// --- Tab 1 + 2: Hàng chờ tiếp nhận (giao) và Tạo lệnh (tao), chung một bảng đơn ---------------
const COT_CHO: CotKh[] = [
  { key: "ma", label: "Mã đơn", coDinh: true, w: 150 },
  { key: "tao", label: "Ngày tạo", w: 104 },
  { key: "chuyen", label: "Chuyển lúc", w: 140 },
  { key: "giao", label: "Ngày giao", w: 104 },
  { key: "khach", label: "Khách hàng", w: 200 },
  { key: "sp", label: "Sản phẩm / Hạng mục", w: 250 },
  { key: "tt", label: "Trạng thái", w: 110 },
  { key: "lenh", label: "Lệnh", w: 140 },
  { key: "nguoi", label: "Người phụ trách", w: 160 },
  { key: "sale", label: "Sale", w: 140 },
  { key: "luuy", label: "Lưu ý sản xuất" },
];

const TT_CHO: Record<TrangThaiCho, { nhan: string; mau: MauTT }> = {
  chua_giao: { nhan: "Chưa giao", mau: "cam" },
  da_giao: { nhan: "Đã giao", mau: "xanh" },
};

function OCho({ cot, o, cheDo }: { cot: string; o: HangChoItem; cheDo: CheDoCho }) {
  switch (cot) {
    case "ma":
      return (
        <td>
          {/* Đơn giao cho mình chưa mở: chấm đỏ cạnh mã, không số (thấy là đã xem khi mở ngăn). */}
          {cheDo === "tao" && o.chua_mo && (
            <span className="khsx-cham-dong" aria-label="Đơn mới giao cho bạn, chưa mở" />
          )}
          {o.order_no}
          {o.is_rush && <ChipGapLuoi />}
        </td>
      );
    case "tt": {
      // Chỉ hai trạng thái: Chưa giao / Đã giao. Đã tạo bao nhiêu lệnh là cột "lenh" bên cạnh.
      const t = TT_CHO[o.trang_thai ?? "chua_giao"];
      return (
        <td>
          <ChipTT mau={t.mau}>{t.nhan}</ChipTT>
        </td>
      );
    }
    case "lenh":
      // Một dòng đơn tính một lệnh. Đơn đủ lệnh thì rời bảng nên ở đây luôn còn thiếu.
      return (
        <td>
          Đã tạo {o.so_dong_co_lsx}/{o.so_dong} lệnh
        </td>
      );
    case "nguoi":
      return o.nguoi_lam_lenh_ten ? (
        <td title={o.nguoi_lam_lenh_ten}>{o.nguoi_lam_lenh_ten}</td>
      ) : (
        <td>
          <span className="lds-mu3">—</span>
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
    case "sale":
      return o.sale_name ? <td title={o.sale_name}>{o.sale_name}</td> : <td><span className="lds-mu3">—</span></td>;
    case "luuy":
      return o.production_note ? <td title={o.production_note}>{o.production_note}</td> : <td><span className="lds-mu3">—</span></td>;
    default:
      return <td />;
  }
}

/** Câu của bảng rỗng khi không lọc gì — nói đúng phạm vi người xem. */
function cauTrong(cheDo: CheDoCho, scope: string | null): string {
  const tuHien = "tự hiện ở đây ngay, không cần tải lại trang.";
  if (cheDo === "giao") {
    return scope === "all"
      ? `Không có đơn nào chờ giao. Đơn Sale chuyển xuống sản xuất ${tuHien}`
      : `Không có đơn nào của bạn chờ giao. Đơn Sale chuyển xuống sản xuất ${tuHien}`;
  }
  if (scope === "all") return `Không có đơn nào đã giao mà chưa tạo đủ lệnh. Đơn được giao ${tuHien}`;
  if (scope === "department") return `Phòng của bạn chưa có đơn nào cần tạo lệnh. Đơn được giao ${tuHien}`;
  return `Chưa có đơn nào giao cho bạn phụ trách. Đơn được giao ${tuHien}`;
}

function QueueTable({
  cheDo,
  rows,
  loi,
  onTaiLai,
  scope,
  onOpen,
  dangMo,
  tt,
  onTt,
  facets,
  chon,
  onChon,
  onGiao,
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
  /** `giao` = Hàng chờ tiếp nhận: chỉ tick và giao, bấm dòng KHÔNG mở lệnh. `tao` = Tạo lệnh: bấm dòng
   *  mở ngăn lệnh dự kiến. */
  cheDo: CheDoCho;
  rows: HangChoItem[] | null;
  /** Lỗi nạp; chỉ vẽ trong dòng rỗng khi `rows === null` (chưa có lượt nạp nào thành công). */
  loi: string | null;
  onTaiLai: () => void;
  scope: string | null;
  onOpen: (orderId: number) => void;
  /** Đơn đang mở ngăn "lệnh dự kiến" — dòng đó viền đủ cạnh. */
  dangMo: number | null;
  /** Chip trạng thái: tat_ca | chua_giao | da_giao (chỉ tab Hàng chờ tiếp nhận). */
  tt: string;
  onTt: (k: string) => void;
  facets: Record<string, number>;
  chon: Map<number, HangChoItem>;
  onChon: (m: Map<number, HangChoItem>) => void;
  onGiao: () => void;
  /** TỔNG đơn trên máy chủ (≠ `rows.length`, vốn chỉ là trang đang xem). */
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
  const giao = cheDo === "giao";
  const luoi = useCauHinhLuoi(giao ? "khsx-hang-cho" : "khsx-tao-lenh");
  const cotHien = luoi.rongHien(luoi.xep(COT_CHO).filter((c) => !luoi.an.has(c.key)));
  const coLoc = ky.loai !== "tat_ca" || tt !== "tat_ca" || dieuKien.some((d) => daAp(d, loc));
  const soCot = cotHien.length + (giao ? 1 : 0);
  const trang = rows ?? [];
  const daTickHet = trang.length > 0 && trang.every((o) => chon.has(o.order_id));
  const tick = (o: HangChoItem) => {
    const m = new Map(chon);
    if (m.has(o.order_id)) m.delete(o.order_id);
    else m.set(o.order_id, o);
    onChon(m);
  };
  const tickTrang = () => {
    const m = new Map(chon);
    if (daTickHet) trang.forEach((o) => m.delete(o.order_id));
    else trang.forEach((o) => m.set(o.order_id, o));
    onChon(m);
  };
  // Tab Tạo lệnh chỉ có đơn Đã giao nên không có chip trạng thái.
  const muc = (["chua_giao", "da_giao"] as const).map(
    (k) => ({ key: k, label: TT_CHO[k].nhan, count: facets[k], mau: TT_CHO[k].mau }),
  );
  return (
    <>
      <section className="lds-loc">
        {giao && (
        <div className="khsx-loc-hang khsx-loc-hang--trai">
          <LocNhanhTrangThai
            ariaLabel="Lọc theo trạng thái"
            muc={[{ key: "tat_ca", label: "Tất cả", count: facets.tat_ca }, ...muc]}
            dang={tt}
            onChon={onTt}
          />
          {/* Chọn đơn thì cụm thao tác nằm phẳng ngay sau chip lọc, không nổi thành thẻ. */}
          {giao && chon.size > 0 && (
            <div className="khsx-bulk" role="region" aria-label="Đơn đã chọn">
              <span>Đã chọn {chon.size} đơn</span>
              <button type="button" className="khsx-bulk__btn khsx-bulk__btn--ghost" onClick={() => onChon(new Map())}>
                Bỏ chọn
              </button>
              <button type="button" className="khsx-bulk__btn khsx-bulk__btn--pri" onClick={onGiao}>
                Giao
              </button>
            </div>
          )}
        </div>
        )}
        <div className="lds-loc__thanh tl-thanh" role="search">
          <ThanhLoc ky={ky} moc={MOC_HANG_CHO} onKy={onKy} dieuKien={dieuKien} loc={loc} onLoc={onLoc} />
          <ChonCot cot={COT_CHO} {...luoi.chonCot} />
        </div>
      </section>
      <div className="lds-sheet">
        {/* Cột tick đứng trước Mã đơn: ghim thêm một cột, không thì Mã đơn trượt xuống dưới cột tick. */}
        <CuonLuoi ghim={luoi.soGhim(cotHien) + (giao ? 1 : 0)}>
          <table className="lds-g" style={{ minWidth: rongLuoi(cotHien) + (giao ? 36 : 0) }}>
            <caption className="sr-only">
              {giao ? "Đơn hàng đã chuyển xuống sản xuất, chờ giao người phụ trách" : "Đơn đã giao, chờ tạo lệnh"}
            </caption>
            <colgroup>
              {giao && <col style={{ width: 36 }} />}
              {cotHien.map((c) => (
                <col key={c.key} style={c.w ? { width: c.w } : undefined} />
              ))}
            </colgroup>
            <thead>
              <tr>
                {giao && (
                  <th className="khsx-cot-tick">
                    <input
                      type="checkbox"
                      className="khsx-tick"
                      aria-label="Chọn mọi đơn của trang này"
                      checked={daTickHet}
                      disabled={trang.length === 0}
                      onChange={tickTrang}
                    />
                  </th>
                )}
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
                  <td colSpan={soCot} className="lds-trong">
                    <span role="alert" className="lds-do">{loi}</span>{" "}
                    <button type="button" className="lds-lk" onClick={onTaiLai}>Thử lại</button>
                  </td>
                </tr>
              ) : rows === null ? (
                <EmptyRow colSpan={soCot} trangThai="dang-tai" />
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={soCot} className="lds-trong">
                    {coLoc ? (
                      <>
                        Không có đơn nào khớp điều kiện đang lọc.{" "}
                        <button
                          type="button"
                          className="lds-lk"
                          onClick={() => {
                            onTt("tat_ca");
                            onXoaLoc();
                          }}
                        >
                          Xoá bộ lọc
                        </button>
                      </>
                    ) : (
                      cauTrong(cheDo, scope)
                    )}
                  </td>
                </tr>
              ) : giao ? (
                // Hàng chờ tiếp nhận chỉ để giao: bấm dòng là tick đơn, không mở lệnh.
                rows.map((o) => (
                  <tr
                    key={o.order_id}
                    className={`lds-dong${chon.has(o.order_id) ? " is-chon" : ""}`}
                    onClick={() => tick(o)}
                  >
                    <td className="khsx-cot-tick" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        className="khsx-tick"
                        aria-label={`Chọn đơn ${o.order_no}`}
                        checked={chon.has(o.order_id)}
                        onChange={() => tick(o)}
                      />
                    </td>
                    {cotHien.map((c) => (
                      <OCho key={c.key} cot={c.key} o={o} cheDo={cheDo} />
                    ))}
                  </tr>
                ))
              ) : (
                rows.map((o) => (
                  <tr
                    key={o.order_id}
                    className={`lds-dong${o.order_id === dangMo ? " is-chon" : ""}`}
                    tabIndex={0}
                    aria-label={`Tạo lệnh cho đơn ${o.order_no}`}
                    onClick={() => onOpen(o.order_id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onOpen(o.order_id);
                      }
                    }}
                  >
                    {cotHien.map((c) => (
                      <OCho key={c.key} cot={c.key} o={o} cheDo={cheDo} />
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
            donVi="đơn"
            ariaLabel={giao ? "Phân trang hàng chờ tiếp nhận" : "Phân trang đơn chờ tạo lệnh"}
          />
        )}
      </div>
    </>
  );
}

// --- Tab 3: danh sách lệnh ---------------------------------------------------
const COT_LENH: CotKh[] = [
  { key: "ma", label: "Mã lệnh", coDinh: true, w: 150 },
  { key: "tao", label: "Ngày tạo", w: 104 },
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
}: {
  cot: string;
  l: LsxListItem;
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
  onGoTao,
  cuaToi,
  onCuaToi,
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
  onGoTao: () => void;
  /** Chip "Của tôi": chỉ lệnh mình phụ trách (lọc ở máy chủ). */
  cuaToi: boolean;
  onCuaToi: (v: boolean) => void;
  dem: (key: string) => number;
}) {
  const luoi = useCauHinhLuoi("khsx-lenh");
  const cotHien = luoi.rongHien(luoi.xep(COT_LENH).filter((c) => !luoi.an.has(c.key)));
  const coLoc = ttFilter !== "all" || q.trim() !== "" || ky.loai !== "tat_ca" || cuaToi
    || dieuKien.some((d) => daAp(d, loc));
  // Số trên hàng lọc nhanh lấy từ `facets` của máy chủ (qua `dem`), cùng bộ lọc trừ trạng thái.
  const muc = TRANG_THAI_TABS.map((t) => ({ key: t.key, label: t.label, count: dem(t.key), mau: MAU_LOC_LENH[t.key] }));
  return (
    <>
      <section className="lds-loc">
        <div className="khsx-loc-hang">
          <LocNhanhTrangThai muc={muc} dang={ttFilter} onChon={onTtFilter} />
          <div className="lds-flt" role="group" aria-label="Lọc theo người phụ trách">
            <button type="button" aria-pressed={cuaToi} className={cuaToi ? "on" : ""} onClick={() => onCuaToi(!cuaToi)}>
              <span>Của tôi</span>
            </button>
          </div>
        </div>
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
                            onCuaToi(false);
                            // `coLoc` tính cả kỳ lẫn mọi điều kiện — sót một cái là bấm xong vẫn rỗng.
                            onXoaLoc();
                          }}
                        >
                          Xoá bộ lọc
                        </button>
                      </>
                    ) : (
                      <>
                        Chưa có lệnh sản xuất nào trong phạm vi của bạn. Lệnh tạo ở tab Tạo lệnh.{" "}
                        <button type="button" className="lds-lk" onClick={onGoTao}>
                          Sang Tạo lệnh →
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
                      <OLenh key={c.key} cot={c.key} l={l} />
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
