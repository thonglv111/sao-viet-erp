// NGĂN một công việc của bàn THỰC HIỆN SẢN XUẤT (`/work-items/{id}` detail) — phương án B
// (09/10/2026, mockup `ban-to-ngan-B-day-du.html`).
//
// Bố cục máy tính: đầu ngăn (lệnh › khách, công đoạn + loại bước + trạng thái có giờ, nút chạy máy,
// ⋯ Đổi máy / Báo sự cố, ✕); thân hai cột — trái là tab làm việc (Quy cách, Sản lượng, Giao và nhận,
// Vật tư, KCS, Lịch sử) cuộn riêng, phải là cột ghim thông tin việc (`ThsxCotPhai`) cuộn riêng.
// Điện thoại (ngăn hẹp ≤ 640px): một cột, cột phải thành tab đầu "Tổng quan", nút chạy máy xuống
// chân cố định ở đáy.
//
// Component KHÔNG tự gọi API ghi: phát ý định qua callback; controller lo dialog lý do + version lạc quan.
// Mọi mặt GHI của pha sau (sản lượng · bàn giao · vật tư) đi qua `exec.*`.
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type {
  SxNhanVienChon, SxWorkItemChiTiet, SxHoTroUngVien,
} from "../api/client";
import type { MayChon } from "../api/kyThuatMay";
import { Button } from "../components/Button";
import { ChipLoaiBuoc } from "../components/ChipBuoc";
import { EmptyState } from "../components/EmptyState";
import { Icon } from "../components/Icons";
import { ChipTT } from "../components/LuoiDs";
import { gioNgan, ngayGio, num } from "./keHoachSxShared";
import { nhanChangLenh } from "./lsxBuoc";
import { batTatRongHet, docDoRong, doRongToiDa, DO_RONG_MIN, ghiDoRong } from "./ke-toan/shared/doRongNgan";
import { MAU_TT, NHAN_TT } from "./ThsxDanhSach";
import { phutChayText, slText } from "./thsxShared";
import { ThsxBaoSuCoDialog } from "./ThsxBaoSuCoDialog";
import { ThsxDoiMay } from "./ThsxDoiMay";
import { ThsxExecPanels, type ThsxExec } from "./ThsxExecPanels";
import type { SxChoCuaViec } from "./thsxChoXacNhan";
import { ThsxKetQuaKcs } from "./ThsxKetQuaKcs";
import { ThsxQuyCachThe } from "./ThsxQuyCach";
import { ThsxCotPhai } from "./thsx/ThsxCotPhai";
import { ThsxTabLichSu } from "./thsx/ThsxTabLichSu";
import "./thsx/thsx-hop.css";

interface Props {
  chiTiet: SxWorkItemChiTiet | null;
  loading: boolean;
  /** Người chọn được cho ô "Giao người" (endpoint riêng của module, gác `san_xuat:read`). */
  candidates: SxNhanVienChon[];
  /** Ứng viên HỖ TRỢ CHÉO (§9) — thợ tổ SX khác đang làm (endpoint riêng module). */
  hoTroUngVien: SxHoTroUngVien[];
  /** Ngày XƯỞNG máy chủ trả kèm hai danh sách trên — ô chọn so đơn nghỉ phép với ngày này. */
  ungVienHomNay?: string | null;
  /** Mở ô chọn người (Giao người / Đề xuất hỗ trợ) — trang nạp lại tình trạng cho tươi. */
  onMoChonNguoi?: () => void;
  /** Danh mục máy (`may-chon` — không đòi quyền `dm_thiet_bi`), chỉ để dựng nhãn máy hiện tại cho
   *  Báo sự cố. Ô "Đổi máy" KHÔNG dùng: nó tự nạp danh sách theo công đoạn + tình trạng (`ThsxDoiMay`). */
  mayOptions: MayChon[];
  /** Hợp đồng các mặt GHI của Giai đoạn 3+4+5. */
  exec: ThsxExec;
  /** Có một lệnh ghi đang bay (khoá nút để tránh double-submit). */
  busy: boolean;
  onGiao: (employeeId: number) => void;
  onRut: (phanCongId: number) => void;
  onBatDau: () => void;
  /** Tổ tích "đã nhận khuôn/khung" — cổng DUY NHẤT mở nút Bắt đầu cho bước cần dụng cụ. */
  onNhanKhuon: () => void;
  /** Tích trả khuôn về kệ sau khi làm xong (không bắt buộc, chỉ để kho biết dao đang ở đâu). */
  onTraKhuon: () => void;
  onTamDung: () => void;
  onKetThuc: () => void;
  onClose: () => void;
  /** Tab mở sẵn — công đoạn đang có việc chờ tổ bấm thì mở thẳng chỗ bấm (Giao và nhận / KCS).
   *  Chỉ đọc lúc mount. Không truyền ⇒ máy tính mở Quy cách, điện thoại mở Tổng quan. */
  tabDau?: ThsxDrawerTab;
  /** Bộ đếm SSE tệp đính kèm theo lệnh (AppShell) — thẻ "Tệp của lệnh" tự nạp lại khi lệnh của nó đổi. */
  dinhKemDem?: Record<number, number>;
  /** Nhịp nạp lại mục "Kết quả KCS" (SSE + sau mỗi lần ghi của bàn). */
  kcsTick?: number;
  /** Lỗi KCS người đang mở còn phải xem — mở tab KCS là ghi "tổ đã xem" cho các lỗi này. */
  kcsLoiChoXem?: ReadonlySet<number>;
  /** Việc chờ tổ bấm của CHÍNH công việc đang mở (§11.5) — chấm đỏ trên tab nơi bấm: Giao và nhận
   *  (bàn giao đến), KCS (lỗi chưa xem). */
  cho?: SxChoCuaViec;
  onXemKcs?: (loiIds: number[]) => void;
  /** Tên tổ của bàn — form Kho mở từ tab Vật tư ghi "Bàn tổ … ›". */
  tenTo?: string;
}

export type ThsxDrawerTab = "tq" | "qc" | "sl" | "gn" | "vt" | "kcs" | "ls";

/** Tên tab cũ (trước ngăn B) → tab mới, cho đường dẫn/thông báo còn ghi tên cũ. */
export function tabTuCu(t: string): ThsxDrawerTab {
  if (t === "nhan" || t === "ban_giao") return "gn";
  if (t === "kcs") return "kcs";
  if (["tq", "qc", "sl", "gn", "vt", "ls"].includes(t)) return t as ThsxDrawerTab;
  return "qc";
}

const DONG_LABEL: Record<string, string> = {
  tam_dung: "tạm dừng",
  ket_thuc: "kết thúc",
  // Đổi máy giữa chừng KHÔNG phải tạm dừng thật (§7.2 mở rộng 31/08/2026, review vòng 1) — nhãn
  // riêng để người xem lịch sử phiên không hiểu lầm công việc đã dừng.
  doi_may: "đổi máy",
};

const hai = (n: number) => String(n).padStart(2, "0");
/** "09/10 11:41"; có `cungNgayVoi` mà trùng ngày thì chỉ "11:58" (cột Đến của bảng Phiên chạy). */
function mocNgayGio(v: string | null | undefined, cungNgayVoi?: string | null): string {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  const gio = `${hai(d.getHours())}:${hai(d.getMinutes())}`;
  if (cungNgayVoi && new Date(cungNgayVoi).toDateString() === d.toDateString()) return gio;
  return `${hai(d.getDate())}/${hai(d.getMonth() + 1)} ${gio}`;
}
function soPhut(batDau: string | null | undefined, ketThuc: string | null | undefined): number | null {
  if (!batDau || !ketThuc) return null;
  const p = Math.round((new Date(ketThuc).getTime() - new Date(batDau).getTime()) / 60000);
  return Number.isFinite(p) && p > 0 ? p : null;
}

/** Ngăn hẹp (điện thoại) — đo CHÍNH khung ngăn, không đo cửa sổ: ngăn kéo hẹp trên máy tính cũng
 *  về một cột. Không có ResizeObserver (jsdom) ⇒ coi như máy tính. */
const NGAN_HEP = 640;
function useNganHep(ref: RefObject<HTMLElement | null>): boolean {
  const [hep, setHep] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setHep(e.contentRect.width > 0 && e.contentRect.width <= NGAN_HEP));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return hep;
}

/** Cửa sổ hẹp tới mức ngăn đã kẹp sẵn ở 480px (điện thoại, cửa sổ thu bé) — kéo cũng không đổi được
 *  gì nên mới gỡ thanh kéo. Đo CỬA SỔ chứ không đo ngăn: 10/10/2026 gỡ theo ngăn hẹp thì ai lỡ kéo
 *  ngăn về dưới 640px là kẹt luôn, không còn chỗ nắm để nới ra. */
function useCuaSoHep(): boolean {
  const tinh = () => typeof window !== "undefined" && doRongToiDa() <= DO_RONG_MIN;
  const [hep, setHep] = useState(tinh);
  useLayoutEffect(() => {
    const doi = () => setHep(tinh());
    window.addEventListener("resize", doi);
    return () => window.removeEventListener("resize", doi);
  }, []);
  return hep;
}

/** Đặt độ rộng chung `--kt-ngan-w` lúc mở ngăn và mỗi lần đổi cỡ cửa sổ. Gắn ở NGĂN, không gắn ở
 *  thanh kéo: thanh kéo bị gỡ khi cửa sổ hẹp, mà cửa sổ thu nhỏ rồi nới lại thì lúc đó sẽ không
 *  còn ai nghe — ngăn kẹt ở 480px (gặp khi bấm thử 10/10/2026). */
function useDoRongNganChung() {
  useLayoutEffect(() => {
    const dat = () => document.documentElement.style.setProperty("--kt-ngan-w", `${docDoRong()}px`);
    dat();
    window.addEventListener("resize", dat);
    return () => window.removeEventListener("resize", dat);
  }, []);
}

/** Thanh kéo mép trái — dùng CHUNG độ rộng `--kt-ngan-w` với mọi ngăn mở từ bên phải (mặc định
 *  1180px, nhớ trong localStorage). Bấm đúp bật/tắt rộng hết. */
function ThanhKeoNgan() {
  const dangKeo = useRef(false);
  const [keo, setKeo] = useState(false);
  return (
    <div
      className={`thsx-b-keo${keo ? " is-keo" : ""}`}
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

export function ThsxDrawer({
  chiTiet, loading, candidates, hoTroUngVien, ungVienHomNay = null, onMoChonNguoi, mayOptions, exec, busy,
  onGiao, onRut, onBatDau, onNhanKhuon, onTraKhuon, onTamDung, onKetThuc, onClose, tabDau, dinhKemDem,
  kcsTick, kcsLoiChoXem, cho, onXemKcs, tenTo,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  useDoRongNganChung();
  const hep = useNganHep(rootRef);
  const cuaSoHep = useCuaSoHep();
  const [tabChon, setTabChon] = useState<ThsxDrawerTab | null>(tabDau ?? null);
  // Máy tính không có tab Tổng quan (cột phải luôn hiện): ngăn kéo từ hẹp ra rộng thì về Quy cách.
  const activeTab: ThsxDrawerTab = tabChon == null || (tabChon === "tq" && !hep) ? (hep ? "tq" : "qc") : tabChon;
  // Các tab dùng chung MỘT khung cuộn — đổi tab mà không kéo về đầu thì tab mới mở ra ở vị trí cuộn
  // của tab cũ (cuộn tới đáy rồi bấm tab khác là thấy ngay đáy tab đó, mất phần đầu).
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [activeTab]);
  // Phiên chạy là vết máy ghi — ít khi cần đọc, mặc định gập (10/10/2026).
  const [moPhien, setMoPhien] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [doiMayOpen, setDoiMayOpen] = useState(false);
  // Báo sự cố (§7.2 mở rộng 31/08/2026) — ô nhập nằm trong ngăn kéo `ThsxBaoSuCoDialog`.
  const [suCoOpen, setSuCoOpen] = useState(false);

  const cv = chiTiet?.cong_viec ?? null;
  // Quyền TRÊN CHÍNH công việc này (máy chủ tính theo dòng quyền của tổ; mức "Của tôi" chỉ bật khi
  // việc đang giao cho mình). Vận hành = Thực hiện lệnh; KCS = KCS; nhập kho = Kho.
  const canAssign = !!chiTiet?.quyen?.run_order;
  // Nút tắt vì hai lý do khác nhau: không được cấp Thực hiện lệnh, hoặc có nhưng mức "Của tôi" mà
  // việc chưa giao cho mình. Câu báo phải nói đúng lý do — người đã bật quyền đọc "cần quyền" là
  // tưởng hệ thống lỗi (16/09/2026).
  const chuaGiaoChoToi = !canAssign && chiTiet?.quyen_muc?.run_order === "own";
  const tt = chiTiet?.trang_thai ?? cv?.trang_thai ?? "released";
  const isMay = cv?.loai_buoc === "may" || cv?.loai_buoc === "thue_ngoai";
  const canDoiMay = canAssign && !busy && (tt === "running" || tt === "paused") && isMay;
  const canBaoSuCo = canDoiMay;

  const rosterActive = (chiTiet?.phan_cong ?? []).filter((p) => p.trang_thai === "active");
  const mayHienTai = mayOptions.find((m) => m.id === cv?.may_id);
  const mayNhanSuCo = mayHienTai ? `${mayHienTai.ma} ${mayHienTai.ten}` : (cv?.may ?? "—");
  const phuDeViec = cv ? (cv.nguon_ma ? `${cv.ten_cong_doan} của ${cv.nguon_ma}` : cv.ten_cong_doan) : undefined;
  const phutChay = cv ? phutChayText(cv) : null;

  // ≥1 người đang giao — công nhật hay khoán đều được (09/10/2026 gỡ luật "≥1 thợ khoán").
  const coNguoi = rosterActive.length > 0;
  const done = tt === "completed";
  const khuonChoNhan = !!cv?.khuon && !cv?.khuon_da_nhan;
  // Cổng routing (`dau_vao.kiem_bat_dau`): công đoạn trước chưa giao sang + mình chưa xác nhận nhận.
  const thieuDauVao = chiTiet?.thieu_dau_vao ?? [];
  // Cổng vật tư (`dau_vao.kiem_bat_dau`): chỉ chặn lần bắt đầu đầu, máy chủ đã tính sẵn câu.
  const vatTu = chiTiet?.vat_tu_chua_san_sang ?? null;
  const canBatDau =
    canAssign && !busy && (tt === "released" || tt === "paused") && coNguoi && !khuonChoNhan &&
    thieuDauVao.length === 0 && !vatTu;
  const canTamDung = canAssign && !busy && tt === "running";
  const canKetThuc = canAssign && !busy && (tt === "running" || tt === "paused");
  // Kết thúc phải giao hết (10/10/2026, chủ xưởng: *"phải đề xuất giao hết thì mới kết thúc được"*):
  // còn hàng tốt chưa đề xuất sang chặng sau thì bấm Kết thúc chỉ đưa sang tab Giao và nhận kèm lời
  // nhắc — máy chủ cũng chặn (`thuc_thi._kiem_giao_het`). Bước cuối lệnh không bàn giao, không chặn.
  const changSau = chiTiet?.ban_giao_chang_sau ?? [];
  const slCv = chiTiet?.san_luong;
  const conChuaGiao = changSau.length > 0 && slCv ? Math.max(0, slCv.tong_tot - slCv.da_giao) : 0;
  const [nhacGiao, setNhacGiao] = useState(false);
  useEffect(() => { setNhacGiao(false); }, [cv?.id]);
  const bamKetThuc = () => {
    if (conChuaGiao > 0.0005) {
      setTabChon("gn");
      setNhacGiao(true);
      return;
    }
    onKetThuc();
  };

  // Chip trạng thái kèm giờ của phiên cuối: "Đang chạy từ 11:41", "Tạm dừng từ 12:10", "Hoàn thành 12:40".
  const phien = chiTiet?.phien_chay ?? [];
  const phienCuoi = phien.length > 0 ? phien[phien.length - 1] : null;
  const gioChip =
    tt === "running" && phienCuoi ? ` từ ${gioNgan(phienCuoi.bat_dau)}`
      : tt === "paused" && phienCuoi?.ket_thuc ? ` từ ${gioNgan(phienCuoi.ket_thuc)}`
        : tt === "completed" && phienCuoi?.ket_thuc ? ` ${gioNgan(phienCuoi.ket_thuc)}`
          : "";

  const soMe = chiTiet?.san_luong?.batches?.length ?? 0;
  const chamGn = !!cho?.nhan;
  const chamKcs = !!cho?.kcs || (kcsLoiChoXem?.size ?? 0) > 0;
  const tabs: { k: ThsxDrawerTab; ten: string; phu?: string; cham?: string | null }[] = [
    ...(hep ? [{ k: "tq" as const, ten: "Tổng quan" }] : []),
    { k: "qc", ten: "Quy cách" },
    { k: "sl", ten: "Sản lượng", phu: soMe > 0 ? `${soMe} lần` : undefined },
    { k: "gn", ten: "Giao và nhận", cham: chamGn ? "Có bàn giao chờ tổ nhận" : null },
    { k: "vt", ten: "Vật tư" },
    { k: "kcs", ten: "KCS", cham: chamKcs ? "Có lỗi KCS chờ tổ xem" : null },
    { k: "ls", ten: "Lịch sử" },
  ];

  const nutChay = cv && !done && (
    tt === "running" ? (
      <>
        <Button variant="secondary" onClick={onTamDung} disabled={!canTamDung}>
          <Icon name="pause" size={14} /> Tạm dừng
        </Button>
        <Button variant="accent" onClick={bamKetThuc} disabled={!canKetThuc}>
          <Icon name="square" size={13} /> Kết thúc
        </Button>
      </>
    ) : tt === "paused" ? (
      <>
        <Button variant="secondary" onClick={bamKetThuc} disabled={!canKetThuc}>
          <Icon name="square" size={13} /> Kết thúc
        </Button>
        <Button variant="accent" onClick={onBatDau} disabled={!canBatDau}>
          <Icon name="play" size={14} /> Tiếp tục
        </Button>
      </>
    ) : (
      <Button variant="accent" onClick={onBatDau} disabled={!canBatDau}>
        <Icon name="play" size={14} /> Bắt đầu
      </Button>
    )
  );

  const cotPhai = cv && chiTiet && (
    <ThsxCotPhai chiTiet={chiTiet} candidates={candidates} ungVienHomNay={ungVienHomNay}
      onMoChonNguoi={onMoChonNguoi} busy={busy} canAssign={canAssign} chuaGiaoChoToi={chuaGiaoChoToi}
      vuong={{ coNguoi, khuonChoNhan, thieuDauVao, vatTu }}
      onGiao={onGiao} onRut={onRut} onNhanKhuon={onNhanKhuon} onTraKhuon={onTraKhuon} dinhKemDem={dinhKemDem} hep={hep} />
  );

  return (
    <div className={`thsx-panel__inner thsx-b${hep ? " is-hep" : ""}`} ref={rootRef}>
      {!cuaSoHep && <ThanhKeoNgan />}

      <header className="thsx-b-hd">
        {hep && (
          <button type="button" className="thsx-b-hd__lui" onClick={onClose} aria-label="Quay lại">
            <span aria-hidden="true">‹</span>
          </button>
        )}
        <div className="thsx-b-hd__chu">
          {cv ? (
            <>
              <div className="thsx-b-hd__crumb">
                <span>{cv.nguon_ma}{cv.nguon_ten ? ` ${cv.nguon_ten}` : ""}</span>
                {cv.khach_hang && !hep && <><i aria-hidden="true">›</i><span>{cv.khach_hang}</span></>}
              </div>
              <div className="thsx-b-hd__ttl">
                <h2>{cv.ten_cong_doan}</h2>
                {!hep && <ChipLoaiBuoc loai_buoc={cv.loai_buoc} nha_cung_cap={cv.nha_cung_cap} />}
                <ChipTT mau={MAU_TT[tt] ?? "xanh"}>{(NHAN_TT[tt] ?? NHAN_TT.released) + gioChip}</ChipTT>
              </div>
            </>
          ) : (
            <div className="thsx-b-hd__ttl"><h2>Chi tiết công việc</h2></div>
          )}
        </div>
        <div className="thsx-b-hd__acts">
          {!hep && nutChay}
          {cv && isMay && !done && (
            <span className="thsx-b-menu">
              <button type="button" className="thsx-b-ic" aria-label="Thêm thao tác" aria-haspopup="menu"
                aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
                <span aria-hidden="true">⋯</span>
              </button>
              {menuOpen && (
                <span className="thsx-b-menu__pop" role="menu" onMouseLeave={() => setMenuOpen(false)}>
                  <button type="button" role="menuitem" disabled={!canDoiMay}
                    onClick={() => { setMenuOpen(false); setDoiMayOpen(true); }}>Đổi máy</button>
                  <button type="button" role="menuitem" disabled={!canBaoSuCo}
                    onClick={() => { setMenuOpen(false); setSuCoOpen(true); }}>Báo sự cố</button>
                </span>
              )}
            </span>
          )}
          {!hep && (
            <button type="button" className="thsx-b-ic" onClick={onClose} aria-label="Đóng">
              <Icon name="x" size={16} />
            </button>
          )}
        </div>
      </header>

      {doiMayOpen && cv && (
        <ThsxDoiMay congViecId={cv.id} mayHienTaiId={cv.may_id} mayHienTai={mayNhanSuCo}
          tenCongDoan={cv.ten_cong_doan} phuDe={phuDeViec} busy={busy}
          onDoi={exec.doiMay} onClose={() => setDoiMayOpen(false)} />
      )}

      <div className="thsx-b-split">
        <div className="thsx-b-trai">
          {cv && (
            <div className="thsx-b-tabs" role="tablist">
              {tabs.map((t) => (
                <button key={t.k} type="button" role="tab" aria-selected={activeTab === t.k}
                  className={`thsx-b-tab${activeTab === t.k ? " is-on" : ""}`} onClick={() => setTabChon(t.k)}>
                  {t.ten}
                  {t.phu && <span className="thsx-b-tab__phu">{t.phu}</span>}
                  {t.cham && <span className="thsx-b-tab__cham" title={t.cham} />}
                </button>
              ))}
            </div>
          )}

          <div className="thsx-panel__body thsx-b-body" ref={bodyRef}>
            {loading && !chiTiet ? (
              <EmptyState trangThai="dang-tai" inline />
            ) : !cv || !chiTiet ? (
              <div className="thsx-panel__empty">Không tải được chi tiết công việc.</div>
            ) : (
              <>
                {activeTab === "tq" && cotPhai}

                {activeTab === "qc" && (
                  <>
                    {/* Thẻ quy cách chạy máy — dùng chung với form kiểm của KCS (`ThsxQuyCach`). */}
                    {cv.quy_cach && <ThsxQuyCachThe qc={cv.quy_cach} trongNgan />}
                    <section className="thsx-b-sec">
                      <h3 className="thsx-b-sec__h">Kế hoạch</h3>
                      <dl className="thsx-b-kv thsx-b-kv--rong">
                        <dt>Khối lượng</dt><dd>{slText(cv)}</dd>
                        <dt>Dự kiến</dt>
                        <dd>
                          {cv.du_kien_bat_dau ? ngayGio(cv.du_kien_bat_dau) : "—"}
                          {" đến "}
                          {cv.du_kien_ket_thuc ? ngayGio(cv.du_kien_ket_thuc) : "—"}
                        </dd>
                        {phutChay && <><dt>Chạy máy</dt><dd>{phutChay}</dd></>}
                        {/* Máy không lặp ở đây — cột phải (tab Tổng quan trên điện thoại) đã ghi. */}
                      </dl>
                    </section>
                    {/* Ghi chú kỹ thuật của quy cách — LUÔN có mục, sau Kế hoạch (mockup B); trống thì nói ra. */}
                    <section className="thsx-b-sec">
                      <h3 className="thsx-b-sec__h">Ghi chú kỹ thuật</h3>
                      {cv.quy_cach?.ghi_chu_ky_thuat?.trim()
                        ? <p className="thsx-b-dando">{cv.quy_cach.ghi_chu_ky_thuat}</p>
                        : <p className="thsx-b-trong">Không có</p>}
                    </section>
                  </>
                )}

                {activeTab === "sl" && (
                  <>
                    <ThsxExecPanels phan="sl" chiTiet={chiTiet} busy={busy} hoTroUngVien={hoTroUngVien}
                      ungVienHomNay={ungVienHomNay} onMoChonNguoi={onMoChonNguoi} exec={exec} tenTo={tenTo} />
                    <section className="thsx-b-sec">
                      <h3 className="thsx-b-sec__h">
                        <button type="button" className="thsx-b-gap" onClick={() => setMoPhien((o) => !o)} aria-expanded={moPhien}>
                          <Icon name="chevron" size={13} /> Phiên chạy <span className="thsx-b-mo3">{phien.length}</span>
                        </button>
                      </h3>
                      {!moPhien ? null : phien.length === 0 ? (
                        <p className="thsx-note">Chưa có phiên chạy nào.</p>
                      ) : (
                        // Bảng theo mockup ban-to-ngan-A-tinh-chinh: Phiên | Từ | Đến | Máy | Người tham gia.
                        // Đến = chip Đang chạy, hoặc giờ kèm số phút và cách đóng phiên ở dòng chữ nhỏ.
                        <div className="thsx-b-tw">
                          <table className="thsx-b-t thsx-b-phien">
                            <thead>
                              <tr><th>Phiên</th><th>Từ</th><th>Đến</th><th>Máy</th><th>Người tham gia</th></tr>
                            </thead>
                            <tbody>
                              {phien.map((ph) => {
                                const nguoi = [...new Map(chiTiet.khoang_tham_gia
                                  .filter((k) => k.phien_chay_id === ph.id)
                                  .map((k) => [k.employee_id, k.ho_ten])).values()];
                                const phut = soPhut(ph.bat_dau, ph.ket_thuc);
                                return (
                                  <tr key={ph.id}>
                                    <td className="thsx-num">{ph.so_thu_tu}</td>
                                    <td className="thsx-num">{mocNgayGio(ph.bat_dau)}</td>
                                    <td>
                                      {ph.ket_thuc == null ? <ChipTT mau={MAU_TT.running}>Đang chạy</ChipTT> : (
                                        <>
                                          <span className="thsx-num">{mocNgayGio(ph.ket_thuc, ph.bat_dau)}</span>
                                          <small className="thsx-b-phien__phu">
                                            {phut != null && <span className="thsx-num">{phut} phút</span>}
                                            {ph.loai_dong && <span>{DONG_LABEL[ph.loai_dong] ?? ph.loai_dong}</span>}
                                          </small>
                                        </>
                                      )}
                                    </td>
                                    <td>{ph.may_ten ?? <span className="thsx-b-mo3">—</span>}</td>
                                    <td>
                                      {nguoi.length === 0 ? <span className="thsx-b-mo3">—</span> : (
                                        <span className="thsx-b-phien__nguoi">{nguoi.map((t, i) => <span key={i}>{t}</span>)}</span>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </section>
                  </>
                )}

                {/* Nhận vào | Giao đi, Các lần giao. */}
                {activeTab === "gn" && nhacGiao && conChuaGiao > 0.0005 && cv && (
                  <div className="thsx-bao thsx-bao--vang thsx-b-bao" role="alert">
                    Còn {num(conChuaGiao)} {nhanChangLenh(cv.don_vi_ra || cv.don_vi_vao, cv.don_vi_tinh)} chưa đề xuất giao sang{" "}
                    {[...new Set(changSau.map((c) => c.ten_cong_doan).filter(Boolean))].join(", ") || "công đoạn sau"}.
                    Đề xuất giao hết rồi mới bấm Kết thúc.
                  </div>
                )}
                {activeTab === "gn" && (
                  <ThsxExecPanels phan="gn" chiTiet={chiTiet} busy={busy} hoTroUngVien={hoTroUngVien}
                    ungVienHomNay={ungVienHomNay} onMoChonNguoi={onMoChonNguoi} exec={exec} tenTo={tenTo} />
                )}

                {activeTab === "vt" && (
                  <ThsxExecPanels phan="vt" chiTiet={chiTiet} busy={busy} hoTroUngVien={hoTroUngVien}
                    ungVienHomNay={ungVienHomNay} onMoChonNguoi={onMoChonNguoi} exec={exec} tenTo={tenTo} />
                )}

                {/* KCS kiểm công đoạn này (theo lệnh, mg 0306): các lần kiểm, lỗi + ảnh. Mở tab là tổ đã xem. */}
                {activeTab === "kcs" && (
                  <ThsxKetQuaKcs congViecId={cv.id} kcsTick={kcsTick} loiChoXem={kcsLoiChoXem} onXem={onXemKcs} />
                )}

                {activeTab === "ls" && <ThsxTabLichSu congViecId={cv.id} tick={chiTiet} />}
              </>
            )}
          </div>
        </div>

        {!hep && cotPhai && (
          <aside className="thsx-b-phai" aria-label="Thông tin việc">{cotPhai}</aside>
        )}
      </div>

      {hep && nutChay && <div className="thsx-b-chan">{nutChay}</div>}

      {suCoOpen && cv && (
        <ThsxBaoSuCoDialog
          mayNhan={mayNhanSuCo}
          tenCongDoan={cv.ten_cong_doan}
          dangChay={tt === "running"}
          busy={busy}
          onGui={exec.baoSuCo}
          onClose={() => setSuCoOpen(false)}
        />
      )}
    </div>
  );
}
