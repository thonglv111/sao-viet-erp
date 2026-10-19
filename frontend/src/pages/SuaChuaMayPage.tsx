// Sửa chữa máy — HAI cửa vào cùng một câu chuyện "máy này hỏng", trên MỘT màn.
//
//   • Yêu cầu báo hỏng: người ngoài tổ kỹ thuật — thợ đứng máy, QC, tổ trưởng — nói "máy tôi
//     hỏng". Là LỜI BÁO, chưa phải việc. Gửi/sửa lời báo gác bằng ô chi tiết
//     `ky_thuat_may:request` ("Báo máy hỏng").
//   • Phiếu sửa chữa: sổ công việc của tổ sửa chữa. Mã SC chạy liên tục, mức độ là kết luận nghề,
//     đóng phiếu đòi ảnh chứng thực. Tiếp nhận/đóng phiếu gác bằng Thao tác của màn.
//
// MỘT màn = MỘT ô quyền `ky_thuat_may` (24/09/2026, mg `0332`): khoá `yeu_cau_sua_chua` cũ không
// có mục thanh bên của riêng nó nên gỡ hẳn, Xem mở cả hai khung.
//
// Không tách thành hai màn (dù là hai bảng): người tổ kỹ thuật phải nhìn thấy hàng
// chờ báo hỏng NGAY CẠNH hàng việc đang làm thì mới tiếp nhận kịp; bắt họ đổi màn là lời báo nằm
// đó cả ca. Chuyển cửa bằng công tắc cạnh tên màn, mỗi lúc chỉ một khung được gắn.
//
// Bố cục (07/10/2026): danh sách theo khuôn lưới chung `LuoiDs` của Báo giá/Đơn hàng (tên màn + nút
// chính một hàng, thẻ lọc trắng gắn liền lưới, chip trạng thái màu `--tt-*`); ngăn chi tiết theo
// phương án A của docs/mockups/ky-thuat-may-ngan-3-phuong-an.html — hai cột kiểu Linear, form lập
// mới là hộp thoại giữa màn.
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useAuth } from "../auth/useAuth";
import { useCan } from "../auth/permissions";
import { Button } from "../components/Button";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { EmptyRow } from "../components/EmptyState";
import { Icon } from "../components/Icons";
import {
  ChonCot, CuonLuoi, LocNhanhTrangThai, OTim, rongLuoi, useCauHinhLuoi, type CauHinhLuoi, type CotLuoi,
} from "../components/LuoiDs";
import { trangHopLe } from "../components/Pager";
import { PhanTrangDayDu } from "../components/PhanTrangDayDu";
import { useTre } from "../lib/useTre";
import {
  kyThuatMay, NHAN_MUC_DO, NHAN_TT_SUA_CHUA, NHAN_TT_YEU_CAU,
  type Anh, type MayChon, type SuaChua, type YeuCau,
} from "../api/kyThuatMay";
import {
  AnhBox, ChipKtm, ChonMucDo, CotPhieu, DongTT, HopThoai, MucDo, NhatKyPhieu, ONhap,
  fmtNgayGio, fmtNgayGioNgan, hienChuDu, keoDai, useManHep,
} from "./KyThuatMayChung";
import { NganPhai } from "./ke-toan/shared/NganPhai";
import { ThanhLoc } from "./thanh-loc/ThanhLoc";
import { dkTheoTab, type DieuKien } from "./thanh-loc/thanh-loc";
import { kyLenUrl, kyTuUrl, thamSoKy, type KyDS } from "./thanh-loc/ky-danh-sach";
import { useLocMan } from "./thanh-loc/useLocMan";
import { ngayDayDu, ngayGioDayDu } from "./loc-san-xuat/ngay";
import {
  LOC_SUA_CHUA_TRONG, MOC_SUA_CHUA, MOC_YEU_CAU, locSuaChuaLenUrl, locSuaChuaTuUrl,
  thamSoLocPhieu, thamSoLocYeuCau, useDieuKienSuaChua, type LocSuaChua,
} from "./loc-ky-thuat-may/dieu-kien-ky-thuat-may";

import "./rebuild-catalog.css";
import "./ke-toan/ke-toan.css";
import "./ky-thuat-may.css";
import { MoLaiPhieuSua } from "./MoLaiPhieuSua";

// Kỳ + bộ lọc của màn — DÙNG CHUNG hai khung (xem `dieu-kien-ky-thuat-may.ts`), ghi lên URL `?man=`.
type LocMan = { ky: KyDS; loc: LocSuaChua };
const LOC_MAN_TRONG: LocMan = { ky: { loai: "tat_ca", moc: "tao" }, loc: LOC_SUA_CHUA_TRONG };
const docLocMan = (p: URLSearchParams): LocMan => ({
  ky: kyTuUrl(p, MOC_SUA_CHUA.map(([m]) => m), "tao"),
  loc: locSuaChuaTuUrl(p),
});
const ghiLocMan = (t: LocMan) => ({ ...kyLenUrl(t.ky, "tao"), ...locSuaChuaLenUrl(t.loc) });

interface Cot extends CotLuoi { w?: number; c?: boolean; title?: string }

/** Cột lưới phiếu sửa chữa, xếp theo nhóm nghĩa: Mã, Ngày, Máy, Mức độ, Trạng thái, các mốc thời gian
 *  của đợt hỏng, Ảnh, Triệu chứng. Bề rộng đủ cho chữ thật (mã, tên máy dài) — tổng vượt khung thì
 *  lưới cuộn ngang như Báo giá, KHÔNG ép cột hẹp lại rồi cắt "IN-0…". Triệu chứng là cột co giãn cuối.
 *  Cột Chỗ hỏng gỡ 11/10/2026: phiếu không còn ô đó, chỉ còn triệu chứng người báo ghi. */
const COT_PHIEU: Cot[] = [
  { key: "ma", label: "Mã phiếu", coDinh: true, w: 100 },
  { key: "ngay", label: "Ngày tạo", w: 110 },
  { key: "may", label: "Máy", w: 270 },
  { key: "muc", label: "Mức độ", w: 130 },
  { key: "tt", label: "Trạng thái", w: 130 },
  { key: "hong", label: "Hỏng lúc", w: 120 },
  { key: "keo", label: "Đã kéo dài", w: 120, title: "Từ lúc hỏng tới giờ, hoặc tới lúc sửa xong" },
  { key: "anh", label: "Ảnh", w: 60, c: true },
  { key: "mota", label: "Triệu chứng" },
];

/** Cột lưới yêu cầu báo hỏng. "Xử lý" (nút lập phiếu / từ chối, hoặc kết quả) đứng CUỐI, co giãn và
 *  CỐ ĐỊNH (không ẩn được: đó là việc chính của hàng chờ); lý do từ chối dài bao nhiêu cũng còn chỗ. */
const COT_YC: Cot[] = [
  { key: "ma", label: "Mã yêu cầu", coDinh: true, w: 110 },
  { key: "ngay", label: "Ngày tạo", w: 120 },
  { key: "may", label: "Máy", w: 270 },
  { key: "muc", label: "Mức độ", w: 180, title: "Mức độ người báo chọn; máy đang dừng thì ghi đỏ bên cạnh" },
  { key: "lsx", label: "Lệnh SX", w: 110, title: "Lệnh đang chạy lúc máy hỏng (báo từ màn Thực hiện sản xuất)" },
  { key: "tt", label: "Trạng thái", w: 140 },
  { key: "nguoi", label: "Người báo", w: 210 },
  { key: "mota", label: "Triệu chứng", w: 240 },
  { key: "xuly", label: "Xử lý", coDinh: true },
];

/** Tổ sửa chữa chỉ ghi MỘT ô chữ trên phiếu: "Đã sửa gì" (cột `nguyen_nhan_phuong_an`), cộng mức độ
 *  đánh giá lại. Triệu chứng là lời người báo — chỉ đọc. Chỗ hỏng / Ghi chú gỡ khỏi màn 11/10/2026
 *  (cột DB còn, phiếu cũ giữ nguyên dữ liệu). */
interface FormSua {
  nguyen_nhan_phuong_an: string;
}

/** "Đã kéo dài" / "Sửa mất" của phiếu: từ lúc hỏng tới giờ (hoặc tới lúc xong), TRỪ quãng phiếu đã
 *  đóng trước khi mở lại (`thoi_gian_dong_giay`, cộng dồn ở máy chủ) — #71. */
const keoDaiPhieu = (p: SuaChua, xong: boolean): string => {
  const hong = p.thoi_diem ? new Date(p.thoi_diem).getTime() + (p.thoi_gian_dong_giay || 0) * 1000 : NaN;
  return Number.isNaN(hong) ? "" : keoDai(new Date(hong).toISOString(), xong ? p.hoan_thanh_at : null);
};

const formTuPhieu = (p: SuaChua): FormSua => ({
  nguyen_nhan_phuong_an: p.nguyen_nhan_phuong_an ?? "",
});

/** Ba thẻ xám lúc đang nạp (bản điện thoại của hàng xương bảng). */
function TheCho() {
  return (
    <>
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="ktm-the is-skel">
          <span className="rc-skel" style={{ width: "45%" }} />
          <span className="rc-skel" style={{ width: "75%" }} />
          <span className="rc-skel" style={{ width: "60%" }} />
        </div>
      ))}
    </>
  );
}

/** Ô chọn máy của hai hộp thoại lập mới. Dữ liệu lấy từ `/ky-thuat-may/may-chon` chứ KHÔNG từ
 *  danh mục thiết bị: `dm_thiet_bi` là quyền của phòng kỹ thuật, thợ đứng máy không có ⇒ dùng
 *  `mayThietBi.list` ở đây là ô chọn rỗng trơn và họ không báo hỏng được. */
function ChonMay({ giaTri, may, loiMay, onChange }: {
  giaTri: string;
  may: MayChon[];
  loiMay: string | null;
  onChange: (v: string) => void;
}) {
  const dangChon = may.find((m) => String(m.id) === giaTri);
  return (
    <label className="ktm-f">
      <span className="ktm-f__nhan">Máy</span>
      <select className="ktm-o" value={giaTri} onChange={(e) => onChange(e.target.value)}>
        <option value="">Chọn máy</option>
        {may.map((m) => <option key={m.id} value={m.id}>{m.ma} {m.ten}</option>)}
      </select>
      {loiMay
        ? <span className="ktm-f__goiy lds-do">{loiMay}</span>
        : dangChon?.loai_may && <span className="ktm-f__goiy">{dangChon.loai_may}</span>}
    </label>
  );
}

/** Ô "Máy" trong lưới và cột thuộc tính: mã, tên mờ bên cạnh. */
function OMay({ ma, ten }: { ma: string | null; ten: string | null }) {
  return <>{ma ?? "—"}{ten && <span className="ktm-phu">{ten}</span>}</>;
}

/** Lưới chung của hai khung: bọc `CuonLuoi` (tiêu đề bám khi cuộn trang, cột mã ghim khi cuộn ngang).
 *  `cot` là danh sách cột ĐANG HIỆN (đã qua ẩn/hiện + đổi chỗ của nút "Cột"). */
function Luoi<T extends { id: number }>({ cot, luoi, rows, loading, rong, o, onMo }: {
  cot: Cot[];
  luoi: CauHinhLuoi;
  rows: T[];
  loading: boolean;
  rong: ReactNode;
  o: (r: T, key: string) => ReactNode;
  onMo: (r: T) => void;
}) {
  return (
    <CuonLuoi ghim={luoi.soGhim(cot)}>
      <table className="lds-g" style={{ minWidth: rongLuoi(cot, 240) }}>
        <colgroup>
          {cot.map((c) => <col key={c.key} style={c.w ? { width: c.w } : undefined} />)}
        </colgroup>
        <thead>
          <tr>
            {cot.map((c) => <th key={c.key} className={c.c ? "c" : undefined} title={c.title}>{c.label}{luoi.keo(c.key)}</th>)}
          </tr>
        </thead>
        <tbody>
          {loading && rows.length === 0 ? (
            <EmptyRow colSpan={cot.length} trangThai="dang-tai" />
          ) : rows.length === 0 ? (
            <tr><td colSpan={cot.length} className="lds-trong">{rong}</td></tr>
          ) : rows.map((r) => (
            <tr key={r.id} className="lds-dong" tabIndex={0} onClick={() => onMo(r)}
              onKeyDown={(e) => {
                if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
                  e.preventDefault();
                  onMo(r);
                }
              }}>
              {cot.map((c) => <OCell key={c.key} c={c}>{o(r, c.key)}</OCell>)}
            </tr>
          ))}
        </tbody>
      </table>
    </CuonLuoi>
  );
}

function OCell({ c, children }: { c: Cot; children: ReactNode }) {
  // Ô bị cắt "…" thì rê chuột hiện chữ đủ — đo lúc rê, ô nào cũng được kể cả ô dựng bằng thẻ.
  return (
    <td className={c.c ? "c" : undefined} onMouseEnter={hienChuDu}>
      {children}
    </td>
  );
}

export function SuaChuaMayPage({ eventTick = 0, onBadgeStale }: {
  /** Nhích mỗi lần có sự kiện SSE (AppShell truyền xuống) — khung yêu cầu nạp lại theo nó để lời
   *  báo mới hiện ngay, không bắt tổ sửa chữa bấm F5. */
  eventTick?: number;
  onBadgeStale?: () => void;
}) {
  const { token } = useAuth();
  const can = useCan();
  const xemPhieu = can("ky_thuat_may", "read");
  // Ai vào được màn này cũng xem được hàng chờ báo hỏng: người thứ hai phải THẤY máy đó có người
  // báo rồi thì mới thôi báo trùng. Từ 24/09/2026 cả hai khung đi chung MỘT ô Xem (mg `0332`) —
  // khoá `yeu_cau_sua_chua` gỡ hẳn vì nó không có mục thanh bên của riêng nó.
  const xemYc = xemPhieu;
  const guiYcDuoc = can("ky_thuat_may", "request");
  const tiepNhanDuoc = can("ky_thuat_may", "create");
  const tuChoiDuoc = can("ky_thuat_may", "update");

  // Tổ sửa chữa mở ra là thấy VIỆC của mình trước; người ngoài chỉ có một khung nên vào thẳng.
  const [khung, setKhung] = useState<"phieu" | "yeu-cau">(xemPhieu ? "phieu" : "yeu-cau");
  const [choXuLy, setChoXuLy] = useState(0);
  const [ycTick, setYcTick] = useState(0);
  // Vừa tiếp nhận một yêu cầu ⇒ nhảy thẳng sang phiếu vừa sinh, khỏi bắt người ta đi tìm mã SC.
  const [moPhieuId, setMoPhieuId] = useState<number | null>(null);

  // Danh sách máy nạp LƯỜI và dùng chung hai khung: chỉ cần khi có ai đó mở form lập mới.
  const [may, setMay] = useState<MayChon[]>([]);
  const [loiMay, setLoiMay] = useState<string | null>(null);
  const [canMay, setCanMay] = useState(false);
  useEffect(() => {
    if (!token || !canMay || may.length > 0) return;
    setLoiMay(null);
    kyThuatMay.mayChon(token).then(setMay)
      // Nuốt lỗi ở đây là ô chọn máy rỗng trơn và người dùng tưởng xưởng chưa khai máy nào.
      .catch((e) => setLoiMay(e instanceof Error ? e.message : "Không tải được danh sách máy."));
  }, [token, canMay, may.length]);
  const onCanMay = useCallback(() => setCanMay(true), []);

  // Chấm trên công tắc = còn yêu cầu chưa ai tiếp nhận. Chỉ hỏi khi có quyền phiếu (cửa của
  // endpoint) — người báo hỏng không cần nó, đây là hàng chờ của tổ sửa chữa.
  useEffect(() => {
    if (!token || !xemPhieu) return;
    kyThuatMay.choXuLy(token).then((r) => setChoXuLy(r.total)).catch(() => {});
  }, [token, xemPhieu, eventTick, ycTick]);

  const doiKhung = (k: "phieu" | "yeu-cau") => { setKhung(k); setMoPhieuId(null); };

  const [locMan, setLocMan] = useLocMan("sua-chua-may", LOC_MAN_TRONG, docLocMan, ghiLocMan);

  // Công tắc đứng NGAY CẠNH tên màn: nó đổi cả màn bên dưới, nấp ở góc phải thì không ai tìm ra.
  const chuyen = xemPhieu && xemYc ? (
    <div className="ktm-xem" role="group" aria-label="Chế độ xem">
      <button type="button" className={`ktm-xem__nut${khung === "phieu" ? " is-active" : ""}`}
        aria-pressed={khung === "phieu"} onClick={() => doiKhung("phieu")}>
        Phiếu sửa chữa
      </button>
      <button type="button" className={`ktm-xem__nut${khung === "yeu-cau" ? " is-active" : ""}`}
        aria-pressed={khung === "yeu-cau"} onClick={() => doiKhung("yeu-cau")}>
        Yêu cầu báo hỏng
        {/* CHẤM, không số: còn yêu cầu chờ tiếp nhận là đủ để rẽ sang — số thì đã nằm trên nút
            lọc "Chờ tiếp nhận" bên kia. */}
        {choXuLy > 0 && <span className="ktm-xem__cham" aria-label="Có yêu cầu chờ tiếp nhận" />}
      </button>
    </div>
  ) : null;

  const ycThayDoi = () => { setYcTick((t) => t + 1); onBadgeStale?.(); };

  if (khung === "phieu" && xemPhieu) {
    return (
      <KhungPhieu
        chuyen={chuyen}
        may={may} loiMay={loiMay} onCanMay={onCanMay}
        moId={moPhieuId} onDaMo={() => setMoPhieuId(null)}
        locMan={locMan} onLocMan={setLocMan}
      />
    );
  }
  return (
    <KhungYeuCau
      chuyen={chuyen}
      locMan={locMan} onLocMan={setLocMan}
      guiDuoc={guiYcDuoc} tiepNhanDuoc={tiepNhanDuoc} tuChoiDuoc={tuChoiDuoc}
      may={may} loiMay={loiMay} onCanMay={onCanMay}
      eventTick={eventTick}
      onThayDoi={ycThayDoi}
      onMoPhieu={xemPhieu ? (id) => { setMoPhieuId(id); setKhung("phieu"); } : undefined}
    />
  );
}

// ==================== Khung 1: phiếu sửa chữa ====================

function KhungPhieu({ chuyen, may, loiMay, onCanMay, moId, onDaMo, locMan, onLocMan }: {
  chuyen: ReactNode;
  may: MayChon[];
  loiMay: string | null;
  onCanMay: () => void;
  moId: number | null;
  onDaMo: () => void;
  locMan: LocMan;
  onLocMan: (t: LocMan) => void;
}) {
  const { token } = useAuth();
  const can = useCan();
  const suaDuoc = can("ky_thuat_may", "update");
  // Tạo phiếu là quyền `create`, sửa nội dung là `update` — gate chung bằng `update` thì vai chỉ
  // được lập phiếu (không được sửa) sẽ không thấy nút nào.
  const taoDuoc = can("ky_thuat_may", "create");

  const [rows, setRows] = useState<SuaChua[]>([]);
  const [dem, setDem] = useState<Record<string, number>>({});
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(25);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const qTre = useTre(q);            // gõ xong 300ms mới hỏi máy chủ, không phải mỗi phím một request
  // Mặc định: máy CÒN NẰM. Phiếu đã đóng tích lại theo tháng, để chung là càng chạy càng phải cuộn.
  const [tab, setTab] = useState<string>("can_lam");
  const [mo, setMo] = useState<SuaChua | "new" | null>(null);
  const dieuKien = useDieuKienSuaChua("phieu");
  const luoi = useCauHinhLuoi("sua-chua-may-phieu");
  const cotHien = luoi.rongHien(luoi.xep(COT_PHIEU).filter((c) => !luoi.an.has(c.key)));
  const khoaLoc = JSON.stringify({ ...thamSoKy(locMan.ky), ...thamSoLocPhieu(locMan.loc) });

  // Lọc + tìm kiếm + phân trang ở SERVER (xem ghi chú cùng chỗ bên màn Phiếu bảo trì).
  const load = useCallback(() => {
    if (!token) return;
    setLoading(true);
    kyThuatMay.listSuaChua(token, {
      q: qTre.trim() || undefined,
      trang_thai: tab === "all" ? undefined : tab,
      ...JSON.parse(khoaLoc),
      page,
      size,
    })
      .then((r) => {
        setRows(r.items); setDem(r.dem ?? {}); setTotal(r.total); setError(null);
        // Đang đứng trang 3 mà bộ lọc co danh sách còn 2 trang ⇒ nhảy về trang cuối, không để
        // người dùng nhìn một bảng rỗng rồi tưởng mất sạch dữ liệu.
        const ve = trangHopLe(page, r.total, size);
        if (ve !== null) setPage(ve);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Không tải được danh sách."))
      .finally(() => setLoading(false));
  }, [token, qTre, tab, khoaLoc, page, size]);

  useEffect(load, [load]);

  // Vừa tiếp nhận một yêu cầu bên khung kia ⇒ mở thẳng phiếu vừa sinh. Nạp ĐÚNG phiếu đó, không
  // dò trong trang hiện tại: phiếu mới nhất chưa chắc nằm ở tab/trang đang đứng.
  useEffect(() => {
    if (!token || moId === null) return;
    kyThuatMay.getSuaChua(token, moId).then(setMo).catch(() => {}).finally(onDaMo);
  }, [token, moId]);

  // Danh sách máy chỉ cần cho hộp "Lập phiếu sửa" — phiếu đã có tự mang mã + tên máy theo.
  useEffect(() => { if (mo === "new") onCanMay(); }, [mo, onCanMay]);

  // Số trên nút lọc đếm ở DB (`dem`), không phải đếm trang đang xem.
  const soChoSua = dem.cho_sua ?? 0;
  const tongTatCa = soChoSua + (dem.da_sua_xong ?? 0);
  // Bảng rỗng vì CHƯA CÓ phiếu nào, hay vì bộ lọc — `dem` đã đi theo bộ lọc nên phải hỏi cả lọc.
  const chuaCo = tongTatCa === 0 && !qTre.trim() && khoaLoc === "{}";

  const doiLoc = (fn: () => void) => { fn(); setPage(1); };
  const datLoc = (t: LocMan) => doiLoc(() => onLocMan(t));
  // Phiếu chỉ còn 2 trạng thái (mg 0379): "Chờ sửa" chính là việc còn phải làm (`can_lam`).
  const tabs = [
    { id: "all", nhan: "Tất cả", so: tongTatCa },
    { id: "can_lam", nhan: NHAN_TT_SUA_CHUA.cho_sua, so: soChoSua },
    { id: "da_sua_xong", nhan: NHAN_TT_SUA_CHUA.da_sua_xong, so: dem.da_sua_xong ?? 0 },
  ];
  // Trạng thái trong nút Lọc = chính hàng lọc nhanh (đọc/ghi `tab`, về trang 1 như bấm nút).
  const dkDu: DieuKien<LocSuaChua>[] = [
    dkTheoTab<LocSuaChua>({
      tabs, tatCa: "all", dang: tab, dat: (id) => doiLoc(() => setTab(id)), anKhoi: true,
    }),
    ...dieuKien,
  ];

  const hepMan = useManHep();
  const xoaLoc = () => doiLoc(() => { setQ(""); setTab("all"); onLocMan(LOC_MAN_TRONG); });
  const rong = chuaCo ? (
    <>
      Chưa có phiếu sửa chữa nào. Máy hỏng thì lập phiếu ngay để có vết.{" "}
      {taoDuoc && <button type="button" className="lds-lk" onClick={() => setMo("new")}>Lập phiếu sửa</button>}
    </>
  ) : (
    <>Không có phiếu nào khớp bộ lọc. <button type="button" className="lds-lk" onClick={xoaLoc}>Xoá bộ lọc</button></>
  );

  const o = (r: SuaChua, key: string): ReactNode => {
    const xong = r.trang_thai === "da_sua_xong";
    switch (key) {
      case "ma": return r.ma;
      case "may": return <OMay ma={r.may_ma} ten={r.may_ten} />;
      case "muc": return <MucDo muc={r.muc_do} nhan={NHAN_MUC_DO[r.muc_do] ?? r.muc_do} />;
      case "tt": return <ChipKtm tt={r.trang_thai}>{NHAN_TT_SUA_CHUA[r.trang_thai] ?? r.trang_thai}</ChipKtm>;
      case "hong": return <span title={ngayGioDayDu(r.thoi_diem)}>{fmtNgayGioNgan(r.thoi_diem)}</span>;
      case "keo": return <span className={xong ? "lds-mu" : undefined}>{keoDaiPhieu(r, xong)}</span>;
      // Chỉ hiện số khi có ảnh. Thiếu ảnh sau khi sửa thì nút đóng phiếu tự chặn và nói lý do —
      // nhắc lại ở đây là một viên đỏ trên mọi dòng đang mở.
      case "anh": return r.so_anh > 0 ? String(r.so_anh) : "";
      case "ngay": return <span className="lds-mu" title={ngayGioDayDu(r.created_at)}>{ngayDayDu(r.created_at)}</span>;
      case "mota": return r.mo_ta ? r.mo_ta : <span className="lds-mu3">—</span>;
      default: return null;
    }
  };

  return (
    <div className="ktm lds">
      <header className="lds-dau">
        <h1 className="lds-dau__ten">Sửa chữa máy</h1>
        {chuyen}
        <div className="lds-dau__nut">
          {taoDuoc && (
            <Button variant="accent" onClick={() => setMo("new")}>
              <Icon name="plus" size={15} /> Lập phiếu sửa
            </Button>
          )}
        </div>
      </header>

      <section className="lds-loc">
        <LocNhanhTrangThai dang={tab} onChon={(id) => doiLoc(() => setTab(id))}
          muc={tabs.map((t) => ({
            key: t.id, label: t.nhan, count: t.so,
            mau: t.id === "can_lam" ? "vang" as const : t.id === "da_sua_xong" ? "la" as const : undefined,
          }))} />
        <div className="lds-loc__thanh tl-thanh" role="search">
          <OTim value={q} onChange={(v) => doiLoc(() => setQ(v))}
            placeholder="Tìm mã phiếu, máy, triệu chứng" ariaLabel="Tìm phiếu sửa chữa" />
          <ThanhLoc
            ky={locMan.ky}
            moc={MOC_SUA_CHUA}
            onKy={(ky) => datLoc({ ...locMan, ky })}
            dieuKien={dkDu}
            loc={locMan.loc}
            onLoc={(loc) => datLoc({ ...locMan, loc })}
          />
          {/* Điện thoại hiện thẻ chứ không hiện lưới nên không có cột để ẩn. */}
          {!hepMan && <ChonCot cot={COT_PHIEU} {...luoi.chonCot} />}
        </div>
      </section>

      {error && (
        <div className="banner banner--error" role="alert">
          <span>{error}</span>
          <button type="button" className="lds-lk" onClick={load}>Tải lại</button>
        </div>
      )}

      {/* Điện thoại: lưới 10 cột ép xuống 375px là mỗi cột ~35px — mỗi phiếu thành một THẺ, giữ đủ
          thông tin của lưới (thiếu tiêu đề cột nên mỗi mẩu tự mang nhãn ngắn). */}
      {hepMan ? (
        <>
          <div className="ktm-the-ds">
            {loading ? <TheCho /> : rows.length === 0 ? <p className="ktm-the-rong">{rong}</p> : rows.map((r) => {
              const xong = r.trang_thai === "da_sua_xong";
              return (
                <button key={r.id} type="button" className={`ktm-the${xong ? " is-xong" : ""}`}
                  onClick={() => setMo(r)}>
                  <span className="ktm-the__dau">
                    <span className="ktm-ma">{r.ma}</span>
                    <ChipKtm tt={r.trang_thai}>{NHAN_TT_SUA_CHUA[r.trang_thai] ?? r.trang_thai}</ChipKtm>
                  </span>
                  <span className="ktm-the__than">
                    <span className="ktm-may-badge">{r.may_ma ?? "—"}</span>
                    <span className="ktm-the__goi">{r.mo_ta || <span className="lds-mu">Không ghi triệu chứng</span>}</span>
                  </span>
                  <span className="ktm-the__meta">
                    <MucDo muc={r.muc_do} nhan={NHAN_MUC_DO[r.muc_do] ?? r.muc_do} />
                    <span>Hỏng {fmtNgayGioNgan(r.thoi_diem)}</span>
                    <span>{xong ? "Sửa mất" : "Đã kéo dài"} {keoDaiPhieu(r, xong)}</span>
                    {r.so_anh > 0 && <span>{r.so_anh} ảnh</span>}
                    <span>Tạo {ngayDayDu(r.created_at)}</span>
                  </span>
                </button>
              );
            })}
          </div>
          {total > 0 && (
            <PhanTrangDayDu trang={page} size={size} tong={total} soDong={rows.length}
              onTrang={setPage} onSize={(n) => { setSize(n); setPage(1); }} loading={loading}
              donVi="phiếu" ariaLabel="Phân trang phiếu sửa chữa" />
          )}
        </>
      ) : (
        <div className="lds-sheet">
          <Luoi cot={cotHien} luoi={luoi} rows={rows} loading={loading} rong={rong} o={o} onMo={setMo} />
          {total > 0 && (
            <PhanTrangDayDu trang={page} size={size} tong={total} soDong={rows.length}
              onTrang={setPage} onSize={(n) => { setSize(n); setPage(1); }} loading={loading}
              donVi="phiếu" ariaLabel="Phân trang phiếu sửa chữa" />
          )}
        </div>
      )}

      {mo === "new" ? (
        <LapPhieuHop may={may} loiMay={loiMay} onClose={() => setMo(null)}
          // Lập xong là để LÀM: mở luôn phiếu vừa lập (thêm ảnh trước khi sửa, ghi nguyên nhân).
          onSaved={(p) => { load(); setMo(p); }} />
      ) : mo ? (
        <SuaChuaDrawer
          phieu={mo}
          suaDuoc={suaDuoc}
          onClose={() => setMo(null)}
          onSaved={(p) => { load(); setMo(p); }}
        />
      ) : null}
    </div>
  );
}

/** Hộp thoại "Lập phiếu sửa" (phương án A4). Người báo và giờ hỏng do máy chủ chốt từ tài khoản +
 *  lúc bấm — không có ô gõ tên. */
function LapPhieuHop({ may, loiMay, onClose, onSaved }: {
  may: MayChon[];
  loiMay: string | null;
  onClose: () => void;
  onSaved: (p: SuaChua) => void;
}) {
  const { token, user } = useAuth();
  const [mayId, setMayId] = useState("");
  const [moTa, setMoTa] = useState("");
  const [mucDo, setMucDo] = useState("trung_binh");
  const [dang, setDang] = useState(false);
  const [loi, setLoi] = useState<string | null>(null);

  const gui = async () => {
    if (!token || dang) return;
    if (!mayId) { setLoi("Chưa chọn máy."); return; }
    setDang(true);
    setLoi(null);
    try {
      const p = await kyThuatMay.createSuaChua(token, {
        may_id: Number(mayId),
        mo_ta: moTa.trim() || null,
        muc_do: mucDo,
      });
      onSaved(p);
    } catch (e) {
      setLoi(e instanceof Error ? e.message : "Lập phiếu không thành công.");
      setDang(false);
    }
  };

  return (
    <HopThoai tieuDe="Lập phiếu sửa" rong={720} nutChinh="Lập phiếu" dangGui={dang} loi={loi}
      coNoiDung={!!(mayId || moTa)}
      onGui={() => void gui()} onDong={onClose}
      chanTrai={<>
        <span>Người báo: {user?.name?.trim() || user?.username || "—"}</span>
        <span>Hỏng lúc: bây giờ</span>
      </>}>
      <ChonMay giaTri={mayId} may={may} loiMay={loiMay} onChange={setMayId} />
      <ONhap nhan="Triệu chứng" nhieuDong giaTri={moTa} khoa={false}
        placeholder="Kể đúng cái mình thấy: máy kêu to ở tốc độ cao, tờ in ra bị nhăn mép"
        onChange={setMoTa} />
      <div className="ktm-hang">
        <span className="ktm-f__nhan">Mức độ</span>
        <ChonMucDo giaTri={mucDo} nhan={NHAN_MUC_DO} onChange={setMucDo} />
      </div>
    </HopThoai>
  );
}

/** Ngăn chi tiết phiếu sửa chữa (phương án A1): trái là triệu chứng (chỉ đọc), MỘT ô "Đã sửa gì" và
 *  ảnh trước/sau; phải là cột thuộc tính đứng yên + nút đóng phiếu ở đáy cột. */
function SuaChuaDrawer({ phieu, suaDuoc, onClose, onSaved }: {
  phieu: SuaChua;
  suaDuoc: boolean;
  onClose: () => void;
  onSaved: (p: SuaChua) => void;
}) {
  const { token } = useAuth();
  const [hienTai, setHienTai] = useState<SuaChua>(phieu);
  const [form, setForm] = useState<FormSua>(() => formTuPhieu(phieu));
  const [luu, setLuu] = useState(false);
  const [dangDoi, setDangDoi] = useState(false);
  const [loi, setLoi] = useState<string | null>(null);
  const [anhTick, setAnhTick] = useState(0);   // đổi ⇒ nạp lại phiếu để cập nhật cờ `co_anh_sau`
  const [anh, setAnh] = useState<Anh[]>([]);
  const [tab, setTab] = useState("chi-tiet");

  const dong = hienTai.trang_thai === "da_sua_xong";
  const khoaSua = !suaDuoc || dong;
  const goc = formTuPhieu(hienTai);
  const doi = (Object.keys(goc) as (keyof FormSua)[]).some((k) => form[k] !== goc[k]);

  useEffect(() => {
    setHienTai(phieu);
    setForm(formTuPhieu(phieu));
  }, [phieu]);

  // Sau khi thêm/xoá ảnh phải nạp lại phiếu: nút "Xác nhận đã sửa xong" mở/khoá theo `co_anh_sau`
  // mà cờ đó do backend tính. Nạp ĐÚNG một phiếu — kéo cả danh sách theo máy rồi `find` thì phiếu
  // nằm ngoài trang đầu là không thấy, và nút cứ khoá mãi dù ảnh đã tải lên.
  useEffect(() => {
    if (!token || anhTick === 0) return;
    kyThuatMay.getSuaChua(token, hienTai.id).then(setHienTai).catch(() => {});
  }, [anhTick, token, hienTai.id]);

  // Ảnh nạp một lần cho cả hai khối (trước/sau) — xem ghi chú ở `AnhBox`.
  const napAnh = useCallback(() => {
    if (!token) return;
    kyThuatMay.listAnh(token, "sua_chua", hienTai.id).then(setAnh)
      // Nuốt lỗi ở đây là ảnh đã tải lên rồi mà khối ảnh vẫn trống và nút xác nhận vẫn khoá —
      // không một dòng nào nói vì sao.
      .catch((e) => setLoi(e instanceof Error ? e.message : "Không tải được danh sách ảnh."));
  }, [token, hienTai.id]);
  useEffect(napAnh, [napAnh]);
  const anhDoi = () => { napAnh(); setAnhTick((t) => t + 1); };

  const set = (k: keyof FormSua, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const luuPhieu = async () => {
    if (!token || luu) return;
    setLuu(true);
    setLoi(null);
    try {
      // Máy đã chốt lúc lập phiếu — không gửi lại.
      const p = await kyThuatMay.updateSuaChua(token, hienTai.id, {
        nguyen_nhan_phuong_an: form.nguyen_nhan_phuong_an.trim() || null,
      });
      setHienTai(p);
      onSaved(p);
    } catch (e) {
      setLoi(e instanceof Error ? e.message : "Lưu không thành công.");
    } finally {
      setLuu(false);
    }
  };

  const xacNhanXong = async () => {
    // `dangDoi` chặn bấm dồn: hai lượt gọi chồng nhau thì lượt về sau ghi đè trạng thái của lượt
    // về trước, và màn hình hiện cái người dùng KHÔNG bấm cuối cùng.
    if (!token || dangDoi) return;
    setLoi(null);
    setDangDoi(true);
    try {
      const p = await kyThuatMay.trangThaiSuaChua(token, hienTai.id, "da_sua_xong");
      setHienTai(p);
      onSaved(p);
    } catch (e) {
      setLoi(e instanceof Error ? e.message : "Không đổi được trạng thái.");
    } finally {
      setDangDoi(false);
    }
  };

  // Nút đóng phiếu: lý do khoá nói thẳng dưới nút, không bắt người ta rê chuột đọc tooltip.
  const lyDoKhoa = !hienTai.co_anh_sau
    ? "Chụp ít nhất 1 ảnh sau khi sửa để mở nút này."
    : doi ? "Lưu thay đổi trước đã." : null;

  const cot = (
    <CotPhieu cuoi={suaDuoc && !dong ? (
      <>
        <Button variant="accent" disabled={!!lyDoKhoa || dangDoi} onClick={() => void xacNhanXong()}>
          {dangDoi ? "Đang lưu…" : "Xác nhận đã sửa xong"}
        </Button>
        {lyDoKhoa && <span className="ktm-ly">{lyDoKhoa}</span>}
      </>
    ) : suaDuoc && dong ? (
      <MoLaiPhieuSua phieuId={hienTai.id} onDone={(p) => { setHienTai(p); onSaved(p); }} />
    ) : undefined}>
      <DongTT nhan="Trạng thái">
        <ChipKtm tt={hienTai.trang_thai}>{NHAN_TT_SUA_CHUA[hienTai.trang_thai] ?? hienTai.trang_thai}</ChipKtm>
      </DongTT>
      <DongTT nhan="Máy"><OMay ma={hienTai.may_ma} ten={hienTai.may_ten} /></DongTT>
      {/* Mức độ là lời người báo — chỉ đọc, như triệu chứng (11/10/2026). */}
      <DongTT nhan="Mức độ">
        <MucDo muc={hienTai.muc_do} nhan={NHAN_MUC_DO[hienTai.muc_do] ?? hienTai.muc_do} />
      </DongTT>
      <DongTT nhan="Người báo">{hienTai.nguoi_bao_ten || hienTai.yeu_cau_nguoi_bao || "—"}</DongTT>
      <DongTT nhan="Hỏng lúc">{fmtNgayGio(hienTai.thoi_diem)}</DongTT>
      <DongTT nhan={dong ? "Sửa mất" : "Đã kéo dài"}>
        {keoDaiPhieu(hienTai, dong) || "—"}
      </DongTT>
      {dong && <DongTT nhan="Sửa xong lúc">{fmtNgayGio(hienTai.hoan_thanh_at)}</DongTT>}
      <DongTT nhan="Từ yêu cầu">
        {hienTai.yeu_cau_ma ? (
          <>{hienTai.yeu_cau_ma}{hienTai.yeu_cau_bo_phan && <span className="ktm-phu">{hienTai.yeu_cau_bo_phan}</span>}</>
        ) : <span className="lds-mu3">không có</span>}
      </DongTT>
      <DongTT nhan="Ngày tạo"><span className="lds-mu">{fmtNgayGio(hienTai.created_at)}</span></DongTT>
    </CotPhieu>
  );

  return (
    <NganPhai
      tieuDe={<span className="ktm-ngan-ma">{hienTai.ma}</span>}
      tabs={[{ id: "chi-tiet", nhan: "Chi tiết" }, { id: "lich-su", nhan: "Lịch sử thao tác" }]}
      tab={tab} onTab={setTab}
      onDong={onClose}
      chanDong={() => doi}
      cot={cot}
      chan={!khoaSua && tab === "chi-tiet" ? (
        <>
          <span className="kt-ngan__xt">{doi ? "Có thay đổi chưa lưu" : ""}</span>
          <Button variant="ghost" disabled={!doi || luu} onClick={() => setForm(goc)}>Bỏ thay đổi</Button>
          <Button variant="accent" disabled={!doi || luu} onClick={() => void luuPhieu()}>
            {luu ? "Đang lưu…" : "Lưu"}
          </Button>
        </>
      ) : undefined}
    >
      {tab === "lich-su" ? (
        <NhatKyPhieu loai="ky_thuat_sua_chua" phieuId={hienTai.id} />
      ) : (
        <div className="ktm-trai">
          {loi && <div className="banner banner--error" role="alert">{loi}</div>}
          <ONhap nhan="Triệu chứng" giaTri={hienTai.mo_ta ?? ""} khoa onChange={() => {}} />
          <ONhap nhan="Đã sửa gì" nhieuDong giaTri={form.nguyen_nhan_phuong_an} khoa={khoaSua}
            placeholder="vd: bạc đạn trục cán mòn, đã thay mới và căn lại trục; còn chờ dây curoa về"
            onChange={(v) => set("nguyen_nhan_phuong_an", v)} />
          <div className="ktm-luoi2">
            <AnhBox loai="sua_chua" phieuId={hienTai.id} giaiDoan="truoc"
              tieuDe="Ảnh trước khi sửa" khoa={khoaSua} tatCaAnh={anh} onChanged={anhDoi} />
            <AnhBox loai="sua_chua" phieuId={hienTai.id} giaiDoan="sau"
              tieuDe="Ảnh sau khi sửa" batBuoc canChu="cần ít nhất 1 ảnh để đóng phiếu"
              khoa={dong || !suaDuoc} tatCaAnh={anh} onChanged={anhDoi} />
          </div>
        </div>
      )}
    </NganPhai>
  );
}

// ==================== Khung 2: yêu cầu báo hỏng ====================

function KhungYeuCau({
  chuyen, guiDuoc, tiepNhanDuoc, tuChoiDuoc, may, loiMay, onCanMay, eventTick,
  onThayDoi, onMoPhieu, locMan, onLocMan,
}: {
  chuyen: ReactNode;
  locMan: LocMan;
  onLocMan: (t: LocMan) => void;
  guiDuoc: boolean;
  tiepNhanDuoc: boolean;
  tuChoiDuoc: boolean;
  may: MayChon[];
  loiMay: string | null;
  onCanMay: () => void;
  eventTick: number;
  onThayDoi: () => void;
  onMoPhieu?: (phieuId: number) => void;
}) {
  const { token } = useAuth();
  const [rows, setRows] = useState<YeuCau[]>([]);
  const [dem, setDem] = useState<Record<string, number>>({});
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(25);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const qTre = useTre(q);
  const [tab, setTab] = useState<string>("cho_tiep_nhan");
  // "Chỉ của tôi" cắt NGANG các trạng thái (một yêu cầu vừa của tôi vừa đang chờ) ⇒ là điều kiện
  // "Người gửi" trên thanh lọc, không phải một nút lọc nhanh nữa.
  const [mo, setMo] = useState<YeuCau | "new" | null>(null);
  const dieuKien = useDieuKienSuaChua("yeu-cau");
  const luoi = useCauHinhLuoi("sua-chua-may-yeu-cau");
  const cotHien = luoi.rongHien(luoi.xep(COT_YC).filter((c) => !luoi.an.has(c.key)));
  const khoaLoc = JSON.stringify({ ...thamSoKy(locMan.ky), ...thamSoLocYeuCau(locMan.loc) });

  const load = useCallback(() => {
    if (!token) return;
    setLoading(true);
    kyThuatMay.listYeuCau(token, {
      q: qTre.trim() || undefined,
      trang_thai: tab === "all" ? undefined : tab,
      ...JSON.parse(khoaLoc),
      page,
      size,
    })
      .then((r) => {
        setRows(r.items); setDem(r.dem ?? {}); setTotal(r.total); setError(null);
        const ve = trangHopLe(page, r.total, size);
        if (ve !== null) setPage(ve);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Không tải được danh sách."))
      .finally(() => setLoading(false));
    // `eventTick`: có yêu cầu mới đẩy về là danh sách tự nhích, không bắt tổ sửa chữa bấm tải lại.
  }, [token, qTre, tab, khoaLoc, page, size, eventTick]);

  useEffect(load, [load]);
  useEffect(() => { if (mo === "new") onCanMay(); }, [mo, onCanMay]);

  const soCho = dem.cho_tiep_nhan ?? 0;
  const tongTatCa = soCho + (dem.da_tao_phieu ?? 0) + (dem.tu_choi ?? 0);
  const chuaCo = tongTatCa === 0 && !qTre.trim() && khoaLoc === "{}";
  const doiLoc = (fn: () => void) => { fn(); setPage(1); };

  const datLoc = (t: LocMan) => doiLoc(() => onLocMan(t));
  const tabs = [
    { id: "all", nhan: "Tất cả", so: tongTatCa },
    { id: "cho_tiep_nhan", nhan: NHAN_TT_YEU_CAU.cho_tiep_nhan, so: soCho },
    { id: "da_tao_phieu", nhan: NHAN_TT_YEU_CAU.da_tao_phieu, so: dem.da_tao_phieu ?? 0 },
    { id: "tu_choi", nhan: NHAN_TT_YEU_CAU.tu_choi, so: dem.tu_choi ?? 0 },
  ];
  // Trạng thái trong nút Lọc = chính hàng lọc nhanh (đọc/ghi `tab`, về trang 1 như bấm nút).
  const dkDu: DieuKien<LocSuaChua>[] = [
    dkTheoTab<LocSuaChua>({
      tabs, tatCa: "all", dang: tab, dat: (id) => doiLoc(() => setTab(id)), anKhoi: true,
    }),
    ...dieuKien,
  ];

  const sauKhiLuu = () => { load(); onThayDoi(); };

  // Lập phiếu / từ chối NGAY TRÊN DÒNG: hàng chờ phải xử lý được không cần mở ngăn. Cả hai vẫn hỏi
  // lại một nhịp — lập phiếu sinh mã SC và kéo ảnh sang, không đảo được.
  const [hoiLap, setHoiLap] = useState<YeuCau | null>(null);
  const [dangLap, setDangLap] = useState(false);
  const [loiLap, setLoiLap] = useState<string | null>(null);
  const [hoiTuChoi, setHoiTuChoi] = useState<YeuCau | null>(null);
  const lapPhieu = async () => {
    if (!token || !hoiLap || dangLap) return;
    setDangLap(true);
    setLoiLap(null);
    try {
      const r = await kyThuatMay.taoPhieuTuYeuCau(token, hoiLap.id, {});
      setHoiLap(null);
      sauKhiLuu();
      // Lập xong là để SỬA: mở thẳng phiếu vừa sinh, khỏi đi tìm mã SC.
      onMoPhieu?.(r.phieu.id);
    } catch (e) {
      // 409 = người khác vừa tiếp nhận trước; câu của máy chủ đã nói phiếu nào.
      setLoiLap(e instanceof Error ? e.message : "Không lập được phiếu.");
    } finally {
      setDangLap(false);
    }
  };
  const tuChoi = async (lyDo: string) => {
    if (!token || !hoiTuChoi) return;
    await kyThuatMay.tuChoiYeuCau(token, hoiTuChoi.id, lyDo);
    setHoiTuChoi(null);
    sauKhiLuu();
  };

  const hepMan = useManHep();
  const xoaLoc = () => doiLoc(() => { setQ(""); onLocMan(LOC_MAN_TRONG); setTab("all"); });
  const rong = chuaCo ? (
    <>
      Chưa ai báo máy hỏng. Máy trục trặc thì báo ngay, tổ sửa chữa thấy liền.{" "}
      {guiDuoc && <button type="button" className="lds-lk" onClick={() => setMo("new")}>Báo máy hỏng</button>}
    </>
  ) : tab === "cho_tiep_nhan" && !qTre.trim() && khoaLoc === "{}" ? (
    "Không còn yêu cầu nào chờ tiếp nhận."
  ) : (
    <>Không có yêu cầu nào khớp bộ lọc. <button type="button" className="lds-lk" onClick={xoaLoc}>Xoá bộ lọc</button></>
  );

  const xuLy = (r: YeuCau, the: boolean): ReactNode => {
    if (r.trang_thai === "cho_tiep_nhan") {
      if (!tiepNhanDuoc && !tuChoiDuoc) return the ? null : <span className="lds-mu3">Chờ tổ sửa chữa</span>;
      return (
        <span className={the ? "ktm-the__nut" : "ktm-nut-dong"} onClick={(e) => e.stopPropagation()}>
          {tiepNhanDuoc && (
            <Button variant={the ? "accent" : "ghost"} onClick={() => { setLoiLap(null); setHoiLap(r); }}>
              Nhận sửa
            </Button>
          )}
          {tuChoiDuoc && <Button variant="ghost" onClick={() => setHoiTuChoi(r)}>Từ chối</Button>}
        </span>
      );
    }
    if (r.trang_thai === "da_tao_phieu") {
      return onMoPhieu && r.phieu_id ? (
        <button type="button" className="lds-lk"
          onClick={(e) => { e.stopPropagation(); onMoPhieu(r.phieu_id as number); }}>
          Sang {r.phieu_ma}
        </button>
      ) : <span className="lds-mu">{r.phieu_ma}</span>;
    }
    return r.ly_do_tu_choi
      ? <span className={the ? "ktm-the__mota" : "lds-mu"} title={r.ly_do_tu_choi}>{the ? `Lý do từ chối: ${r.ly_do_tu_choi}` : r.ly_do_tu_choi}</span>
      : null;
  };

  const o = (r: YeuCau, key: string): ReactNode => {
    switch (key) {
      case "ma": return r.ma;
      case "may": return <OMay ma={r.may_ma} ten={r.may_ten} />;
      // "dừng máy" là dấu hiệu DUY NHẤT ăn màu đỏ ở bảng này — ít dòng có và là thứ đẩy yêu cầu
      // lên đầu hàng chờ.
      case "muc": return (
        <>
          <MucDo muc={r.muc_do} nhan={NHAN_MUC_DO[r.muc_do] ?? r.muc_do} />
          {r.may_dung && <span className="ktm-phu lds-do">dừng máy</span>}
        </>
      );
      case "nguoi": return (
        <>{r.nguoi_bao_ten ?? "—"}{r.bo_phan && <span className="lds-tag">{r.bo_phan}</span>}</>
      );
      case "lsx": return r.lsx_ma ?? "";
      case "tt": return <ChipKtm tt={r.trang_thai}>{NHAN_TT_YEU_CAU[r.trang_thai] ?? r.trang_thai}</ChipKtm>;
      case "ngay": return <span className="lds-mu" title={ngayGioDayDu(r.created_at)}>{fmtNgayGioNgan(r.created_at)}</span>;
      case "mota": return r.mo_ta ? r.mo_ta : <span className="lds-mu3">—</span>;
      case "xuly": return xuLy(r, false);
      default: return null;
    }
  };

  return (
    <div className="ktm lds">
      <header className="lds-dau">
        <h1 className="lds-dau__ten">Sửa chữa máy</h1>
        {chuyen}
        <div className="lds-dau__nut">
          {guiDuoc && (
            <Button variant="accent" onClick={() => setMo("new")}>
              <Icon name="plus" size={15} /> Báo máy hỏng
            </Button>
          )}
        </div>
      </header>

      <section className="lds-loc">
        <LocNhanhTrangThai dang={tab} onChon={(id) => doiLoc(() => setTab(id))}
          muc={tabs.map((t) => ({
            key: t.id, label: t.nhan, count: t.so,
            mau: t.id === "all" ? undefined : ({ cho_tiep_nhan: "cam", da_tao_phieu: "la", tu_choi: "do" } as const)[t.id as "cho_tiep_nhan"],
          }))} />
        <div className="lds-loc__thanh tl-thanh" role="search">
          <OTim value={q} onChange={(v) => doiLoc(() => setQ(v))}
            placeholder="Tìm mã yêu cầu, máy, triệu chứng" ariaLabel="Tìm yêu cầu báo hỏng" />
          <ThanhLoc
            ky={locMan.ky}
            moc={MOC_YEU_CAU}
            onKy={(ky) => datLoc({ ...locMan, ky })}
            dieuKien={dkDu}
            loc={locMan.loc}
            onLoc={(loc) => datLoc({ ...locMan, loc })}
          />
          {/* Điện thoại hiện thẻ chứ không hiện lưới nên không có cột để ẩn. */}
          {!hepMan && <ChonCot cot={COT_YC} {...luoi.chonCot} />}
        </div>
      </section>

      {error && (
        <div className="banner banner--error" role="alert">
          <span>{error}</span>
          <button type="button" className="lds-lk" onClick={load}>Tải lại</button>
        </div>
      )}

      {/* Điện thoại: thẻ thay lưới. Hai nút lập phiếu/từ chối nằm to ở đáy thẻ — đây là việc chính
          của hàng chờ, nút nhỏ trong ô hẹp thì ngón tay bấm trượt. Thẻ là `div` vì trong nó có nút
          (button lồng button là HTML sai). */}
      {hepMan ? (
        <>
          <div className="ktm-the-ds">
            {loading ? <TheCho /> : rows.length === 0 ? <p className="ktm-the-rong">{rong}</p> : rows.map((r) => (
              <div key={r.id} role="button" tabIndex={0} className="ktm-the"
                onClick={() => setMo(r)}
                onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) setMo(r); }}>
                <span className="ktm-the__dau">
                  <span className="ktm-ma">{r.ma}</span>
                  <ChipKtm tt={r.trang_thai}>{NHAN_TT_YEU_CAU[r.trang_thai] ?? r.trang_thai}</ChipKtm>
                </span>
                <span className="ktm-the__than">
                  <span className="ktm-may-badge">{r.may_ma ?? "—"}</span>
                  <span className="ktm-the__goi">{r.mo_ta || <span className="lds-mu">Không ghi triệu chứng</span>}</span>
                </span>
                <span className="ktm-the__meta">
                  {r.may_dung && <span className="lds-do">Máy đang dừng</span>}
                  <MucDo muc={r.muc_do} nhan={NHAN_MUC_DO[r.muc_do] ?? r.muc_do} />
                  {r.nguoi_bao_ten && <span>{r.nguoi_bao_ten}</span>}
                  {r.bo_phan && <span className="lds-tag">{r.bo_phan}</span>}
                  {r.lsx_ma && <span>Lệnh {r.lsx_ma}</span>}
                  <span>Tạo {fmtNgayGioNgan(r.created_at)}</span>
                </span>
                {xuLy(r, true)}
              </div>
            ))}
          </div>
          {total > 0 && (
            <PhanTrangDayDu trang={page} size={size} tong={total} soDong={rows.length}
              onTrang={setPage} onSize={(n) => { setSize(n); setPage(1); }} loading={loading}
              donVi="yêu cầu" ariaLabel="Phân trang yêu cầu sửa chữa" />
          )}
        </>
      ) : (
        <div className="lds-sheet">
          <Luoi cot={cotHien} luoi={luoi} rows={rows} loading={loading} rong={rong} o={o} onMo={setMo} />
          {total > 0 && (
            <PhanTrangDayDu trang={page} size={size} tong={total} soDong={rows.length}
              onTrang={setPage} onSize={(n) => { setSize(n); setPage(1); }} loading={loading}
              donVi="yêu cầu" ariaLabel="Phân trang yêu cầu sửa chữa" />
          )}
        </div>
      )}

      {mo === "new" ? (
        <BaoHongHop may={may} loiMay={loiMay} onClose={() => setMo(null)}
          // Gửi xong mở luôn yêu cầu vừa gửi: chụp ảnh chỗ hỏng là bước kế tiếp.
          onSaved={(y) => { sauKhiLuu(); setMo(y); }} />
      ) : mo ? (
        <YeuCauDrawer
          yc={mo}
          tiepNhanDuoc={tiepNhanDuoc} tuChoiDuoc={tuChoiDuoc}
          onClose={() => setMo(null)}
          onSaved={(y) => { sauKhiLuu(); setMo(y); }}
          onMoPhieu={onMoPhieu}
        />
      ) : null}

      <ConfirmDialog open={!!hoiLap} busy={dangLap} error={loiLap}
        title={`Nhận sửa ${hoiLap?.ma ?? ""}`}
        confirmLabel="Nhận sửa" cancelLabel="Quay lại"
        onConfirm={() => void lapPhieu()} onCancel={() => setHoiLap(null)}>
        <p className="ktm-hoi">
          Lập phiếu sửa cho {hoiLap?.may_ma} rồi mở luôn phiếu đó để ghi đã sửa gì và ảnh sau khi sửa.
          Triệu chứng, mức độ và ảnh người báo chép sang phiếu.
        </p>
      </ConfirmDialog>
      <TuChoiDialog open={!!hoiTuChoi} ma={hoiTuChoi?.ma ?? ""}
        onCancel={() => setHoiTuChoi(null)} onConfirm={tuChoi} />
    </div>
  );
}

/** Hộp thoại "Báo máy hỏng" (phương án A3). Người báo + bộ phận lấy từ tài khoản. */
function BaoHongHop({ may, loiMay, onClose, onSaved }: {
  may: MayChon[];
  loiMay: string | null;
  onClose: () => void;
  onSaved: (y: YeuCau) => void;
}) {
  const { token, user } = useAuth();
  const [mayId, setMayId] = useState("");
  const [moTa, setMoTa] = useState("");
  const [mucDo, setMucDo] = useState("trung_binh");
  const [mayDung, setMayDung] = useState(false);
  const [dang, setDang] = useState(false);
  const [loi, setLoi] = useState<string | null>(null);

  const gui = async () => {
    if (!token || dang) return;
    if (!mayId) { setLoi("Chưa chọn máy."); return; }
    setDang(true);
    setLoi(null);
    try {
      const y = await kyThuatMay.taoYeuCau(token, {
        may_id: Number(mayId),
        mo_ta: moTa.trim() || null,
        muc_do: mucDo,
        may_dung: mayDung,
      });
      onSaved(y);
    } catch (e) {
      setLoi(e instanceof Error ? e.message : "Gửi không thành công.");
      setDang(false);
    }
  };

  return (
    <HopThoai tieuDe="Báo máy hỏng" nutChinh="Gửi yêu cầu" dangGui={dang} loi={loi}
      coNoiDung={!!(mayId || moTa)}
      onGui={() => void gui()} onDong={onClose}
      chanTrai={<span>Người báo: {user?.name?.trim() || user?.username || "—"}</span>}>
      <ChonMay giaTri={mayId} may={may} loiMay={loiMay} onChange={setMayId} />
      <ONhap nhan="Triệu chứng" nhieuDong giaTri={moTa} khoa={false}
        placeholder="Kể đúng cái mình thấy: máy kêu to ở tốc độ cao, tờ in ra bị nhăn mép"
        onChange={setMoTa} />
      <div className="ktm-hang">
        <ChonMucDo giaTri={mucDo} nhan={NHAN_MUC_DO} onChange={setMucDo} />
        <label className="ktm-o-chon">
          <input type="checkbox" checked={mayDung} onChange={(e) => setMayDung(e.target.checked)} />
          Máy đang dừng, không chạy được
        </label>
      </div>
      <span className="ktm-f__goiy">
        Mức độ chọn theo cảm nhận, tổ sửa chữa đánh giá lại khi tiếp nhận. Máy dừng thì yêu cầu lên
        đầu hàng chờ.
      </span>
    </HopThoai>
  );
}

/** Ngăn chi tiết yêu cầu báo hỏng — TỜ ĐỌC lời báo (11/10/2026), không ô nhập: người báo chỉ ghi
 *  triệu chứng, tổ sửa chữa không phải điền gì ở đây. "Nhận sửa" sinh phiếu và chuyển thẳng sang phiếu
 *  đó — chỗ hỏng, nguyên nhân, ảnh sau khi sửa đều ghi trên phiếu. Ảnh: người báo còn thêm được khi
 *  yêu cầu chờ tiếp nhận; người khác chỉ thấy khối ảnh khi đã có ảnh. */
function YeuCauDrawer({ yc, tiepNhanDuoc, tuChoiDuoc, onClose, onSaved, onMoPhieu }: {
  yc: YeuCau;
  tiepNhanDuoc: boolean;
  tuChoiDuoc: boolean;
  onClose: () => void;
  onSaved: (y: YeuCau) => void;
  onMoPhieu?: (phieuId: number) => void;
}) {
  const { token, user } = useAuth();
  const [hienTai, setHienTai] = useState<YeuCau>(yc);
  const [loi, setLoi] = useState<string | null>(null);
  const [anh, setAnh] = useState<Anh[]>([]);
  const [tab, setTab] = useState("chi-tiet");
  const [dangNhan, setDangNhan] = useState(false);
  const [hoiTuChoi, setHoiTuChoi] = useState(false);

  const daXuLy = hienTai.trang_thai !== "cho_tiep_nhan";
  const cuaToi = !!user && hienTai.nguoi_bao_id === user.id;

  useEffect(() => { setHienTai(yc); }, [yc]);

  const napAnh = useCallback(() => {
    if (!token) return;
    // Ảnh ĐỔI CHỦ sang phiếu lúc nhận sửa ⇒ yêu cầu đã thành phiếu thì đọc theo cặp mới, đọc theo
    // `yeu_cau` sẽ ra rỗng và người báo tưởng ảnh của mình bay mất.
    const loai = hienTai.phieu_id ? "sua_chua" : "yeu_cau";
    kyThuatMay.listAnh(token, loai, hienTai.phieu_id ?? hienTai.id).then(setAnh)
      .catch((e) => setLoi(e instanceof Error ? e.message : "Không tải được danh sách ảnh."));
  }, [token, hienTai.id, hienTai.phieu_id]);
  useEffect(napAnh, [napAnh]);

  const nhanSua = async () => {
    if (!token || dangNhan) return;
    setLoi(null);
    setDangNhan(true);
    try {
      const r = await kyThuatMay.taoPhieuTuYeuCau(token, hienTai.id, {});
      onSaved(r.yeu_cau);
      // Nhận là để SỬA: mở thẳng phiếu vừa sinh, khỏi sang tab Phiếu sửa chữa đi tìm mã SC.
      if (onMoPhieu) onMoPhieu(r.phieu.id);
      else setHienTai(r.yeu_cau);
    } catch (e) {
      // 409 = người khác vừa nhận trước. Câu của backend đã nói rõ phiếu nào, cứ hiện nguyên.
      setLoi(e instanceof Error ? e.message : "Không nhận sửa được.");
    } finally {
      setDangNhan(false);
    }
  };

  const tuChoi = async (lyDo: string) => {
    const y = await kyThuatMay.tuChoiYeuCau(token!, hienTai.id, lyDo);
    setHienTai(y);
    onSaved(y);
    setHoiTuChoi(false);
  };

  // KHÔNG có nút xoá yêu cầu — cũng không có endpoint. Bỏ một lời báo phải đi qua "Từ chối" kèm lý
  // do: xoá lặng là người báo không bao giờ biết vì sao.
  const cuoi = !daXuLy && (tiepNhanDuoc || tuChoiDuoc) ? (
    <>
      {tiepNhanDuoc && (
        <Button variant="accent" disabled={dangNhan} onClick={() => void nhanSua()}>
          {dangNhan ? "Đang nhận…" : "Nhận sửa"}
        </Button>
      )}
      {tuChoiDuoc && (
        <Button variant="ghost" className="ktm-nut-do" onClick={() => setHoiTuChoi(true)}>Từ chối</Button>
      )}
    </>
  ) : undefined;

  const cot = (
    <CotPhieu cuoi={cuoi}>
      <DongTT nhan="Trạng thái">
        <ChipKtm tt={hienTai.trang_thai}>{NHAN_TT_YEU_CAU[hienTai.trang_thai] ?? hienTai.trang_thai}</ChipKtm>
      </DongTT>
      {/* Kết cục của lời báo đứng ngay dưới trạng thái: người gửi mở ra là biết được xử lý thế nào. */}
      {hienTai.trang_thai === "da_tao_phieu" && (
        <DongTT nhan="Phiếu sửa">
          {onMoPhieu && hienTai.phieu_id ? (
            <button type="button" className="lds-lk" onClick={() => onMoPhieu(hienTai.phieu_id as number)}>
              {hienTai.phieu_ma}
            </button>
          ) : hienTai.phieu_ma}
        </DongTT>
      )}
      {hienTai.trang_thai === "tu_choi" && (
        <DongTT nhan="Lý do từ chối"><span className="lds-do">{hienTai.ly_do_tu_choi}</span></DongTT>
      )}
      {daXuLy && hienTai.xu_ly_ten && <DongTT nhan="Người xử lý">{hienTai.xu_ly_ten}</DongTT>}
      {daXuLy && <DongTT nhan="Xử lý lúc">{fmtNgayGio(hienTai.xu_ly_at)}</DongTT>}
      <DongTT nhan="Máy"><OMay ma={hienTai.may_ma} ten={hienTai.may_ten} /></DongTT>
      <DongTT nhan="Mức độ">
        <MucDo muc={hienTai.muc_do} nhan={NHAN_MUC_DO[hienTai.muc_do] ?? hienTai.muc_do} />
      </DongTT>
      <DongTT nhan="Máy dừng">
        {hienTai.may_dung ? <span className="lds-do">Máy đang dừng</span> : <span className="lds-mu">Vẫn chạy được</span>}
      </DongTT>
      <DongTT nhan="Người báo">
        {hienTai.nguoi_bao_ten ?? "—"}{hienTai.bo_phan && <span className="lds-tag">{hienTai.bo_phan}</span>}
      </DongTT>
      <DongTT nhan="Hỏng lúc">{fmtNgayGio(hienTai.thoi_diem)}</DongTT>
      {hienTai.lsx_ma && <DongTT nhan="Lệnh SX">{hienTai.lsx_ma}</DongTT>}
    </CotPhieu>
  );

  const themAnhDuoc = !daXuLy && cuaToi;

  return (
    <>
      <NganPhai
        tieuDe={<span className="ktm-ngan-ma">{hienTai.ma}</span>}
        tabs={[{ id: "chi-tiet", nhan: "Chi tiết" }, { id: "lich-su", nhan: "Lịch sử thao tác" }]}
        tab={tab} onTab={setTab}
        onDong={onClose}
        cot={cot}
      >
        {tab === "lich-su" ? (
          <NhatKyPhieu loai="ky_thuat_yeu_cau" phieuId={hienTai.id} />
        ) : (
          <div className="ktm-trai">
            {loi && <div className="banner banner--error" role="alert">{loi}</div>}
            <ONhap nhan="Triệu chứng" giaTri={hienTai.mo_ta ?? ""} khoa onChange={() => {}} />
            {(themAnhDuoc || anh.length > 0) && (
              <AnhBox loai={hienTai.phieu_id ? "sua_chua" : "yeu_cau"}
                phieuId={hienTai.phieu_id ?? hienTai.id} giaiDoan="truoc"
                tieuDe={hienTai.phieu_id ? "Ảnh chỗ hỏng (đã chuyển sang phiếu)" : "Ảnh chỗ hỏng"}
                khoa={!themAnhDuoc} tatCaAnh={anh} onChanged={napAnh} />
            )}
          </div>
        )}
      </NganPhai>

      <TuChoiDialog open={hoiTuChoi} ma={hienTai.ma}
        onCancel={() => setHoiTuChoi(false)} onConfirm={tuChoi} />
    </>
  );
}

/** Từ chối BẮT BUỘC kèm lý do — và lý do đó đẩy thẳng về người báo. Cùng khuôn với hộp huỷ phiếu
 *  bảo trì: hộp thoại riêng, không phải `window.prompt`. */
function TuChoiDialog({ open, ma, onCancel, onConfirm }: {
  open: boolean;
  ma: string;
  onCancel: () => void;
  onConfirm: (lyDo: string) => Promise<void>;
}) {
  const [lyDo, setLyDo] = useState("");
  const [busy, setBusy] = useState(false);
  const [loi, setLoi] = useState<string | null>(null);

  useEffect(() => { if (open) { setLyDo(""); setLoi(null); } }, [open]);

  const chay = async () => {
    if (!lyDo.trim()) { setLoi("Phải ghi lý do, người báo cần đọc được vì sao."); return; }
    setBusy(true);
    setLoi(null);
    try {
      await onConfirm(lyDo.trim());
    } catch (e) {
      setLoi(e instanceof Error ? e.message : "Không từ chối được.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ConfirmDialog open={open} danger busy={busy} error={loi}
      title={`Từ chối ${ma}`}
      confirmLabel="Từ chối yêu cầu" cancelLabel="Quay lại"
      confirmDisabled={!lyDo.trim()}
      onConfirm={() => void chay()} onCancel={onCancel}>
      <div className="ktm-boqua-form">
        <p>Yêu cầu sẽ đóng lại và người báo nhận được lý do này ngay.</p>
        <label className="ktm-f">
          <span className="ktm-f__nhan">Lý do</span>
          <textarea className="ktm-o" rows={3} value={lyDo} autoFocus
            placeholder="vd: máy này đã có YC-0004 báo cùng lỗi"
            onChange={(e) => setLyDo(e.target.value)} />
        </label>
      </div>
    </ConfirmDialog>
  );
}
