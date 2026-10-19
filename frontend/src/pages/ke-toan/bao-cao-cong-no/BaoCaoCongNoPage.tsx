// BÁO CÁO CÔNG NỢ (131 Phải thu · 331 Phải trả) — sổ tổng hợp theo kỳ chốt + sổ chi tiết + khoá kỳ.
//
// Phương án C (11/10/2026, docs/mockups/tong-hop-cong-no-3-phuong-an.html): MỘT lưới gồm cả sổ của
// kỳ (còn nợ đầu kỳ, nhận hàng, đã trả, còn nợ cuối kỳ) lẫn còn nợ cuối kỳ chia theo hạn (sáu mốc tuổi
// nợ máy chủ tính TẠI ngày cuối kỳ). Khuôn lưới chung `lds-*`: lọc nhanh có số, ô tìm, kỳ chốt, nút
// Lọc, nút Cột (ẩn, đổi chỗ, kéo rộng, ghim). Lọc + cắt trang + dòng Cộng đều ở MÁY CHỦ.
//
// Bỏ hai cặp cột Nợ/Có kiểu MISA: người đọc phải nhớ 331 dư bên Có. Lưới nói thẳng "còn nợ";
// số trả trước (dư bên kia) nằm ở cột Ghi chú. File Excel xuất ra vẫn đúng mẫu MISA.
//
// Bấm dòng mở ngăn Sổ chi tiết; bấm số quá hạn mở ngăn ở tab Đợt còn nợ / Hoá đơn còn nợ.
//
// Nút Bảng | Biểu đồ (12/10/2026, phương án A của docs/mockups/bao-cao-cong-no-bieu-do-3-phuong-an.html):
// dạng biểu đồ tải trang đầu 10 dòng xếp theo còn nợ giảm dần, cùng bộ lọc với bảng — xem BieuDoCongNo.
import { CalendarDays, ChevronDown, Hourglass } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import {
  ApiError,
  api,
  type BaoCaoCongNo,
  type CongNoDong,
  type CongNoKhoaSoTrangThai,
  type CongNoKyRow,
  type CongNoThe,
} from "../../../api/client";
import { useCan } from "../../../auth/permissions";
import { useAuth } from "../../../auth/useAuth";
import type { NavigateFn } from "../../../components/AppShell";
import { Button } from "../../../components/Button";
import { ChonNgay } from "../../../components/ChonNgay";
import { ConfirmDialog } from "../../../components/ConfirmDialog";
import { EmptyRow } from "../../../components/EmptyState";
import { Icon } from "../../../components/Icons";
import {
  ChipTT, ChonCot, CuonLuoi, LocNhanhTrangThai, OTim, rongLuoi, soVN, useCauHinhLuoi,
  type CotLuoi, type MauTT, type MucLocNhanh,
} from "../../../components/LuoiDs";
import { PhanTrangDayDu } from "../../../components/PhanTrangDayDu";
import { useDebounced } from "../../../utils/useDebounced";
import { LopNoi, ThanhLoc, useDongKhiRaNgoai } from "../../thanh-loc/ThanhLoc";
import { dkTheoTab, type DieuKien } from "../../thanh-loc/thanh-loc";
import { diChuyen } from "../shared/BangPhieu";
import { nhanMoc } from "../shared/locCongNo";
import { NhomNut } from "../shared/NhomNut";
import { BieuDoCongNo } from "./BieuDoCongNo";
import { SoChiTietDrawer, type TabSo } from "./SoChiTietDrawer";
import { chieuDong } from "./shared/chieu";
import { nhanKy, type Ky } from "./shared/ky";
import "../ke-toan.css";
import "./bao-cao-cong-no.css";

/** Chữ của từng bên. Số "tăng" / "giảm" / "còn nợ" đã quy về chiều còn nợ — xem `chieuDong`. */
const CHU = {
  payables: {
    tieuDe: "Tổng hợp công nợ phải trả", doiTac: "Nhà cung cấp", donVi: "nhà cung cấp",
    tang: "Nhận hàng", giam: "Đã trả", traTruoc: "đã trả trước", timGoiY: "Tìm mã hoặc tên nhà cung cấp",
  },
  receivables: {
    tieuDe: "Tổng hợp công nợ phải thu", doiTac: "Khách hàng", donVi: "khách hàng",
    tang: "Bán ra", giam: "Đã thu", traTruoc: "khách trả trước", timGoiY: "Tìm mã hoặc tên khách hàng",
  },
} as const;

/** Bốn mục lọc nhanh; máy chủ đếm (`dem_the`). Chấm màu chỉ ở mục có nghĩa phân loại. */
const THE: { key: CongNoThe; nhan: string; mau?: MauTT }[] = [
  { key: "all", nhan: "Tất cả" },
  { key: "con_no", nhan: "Còn nợ", mau: "cam" },
  { key: "qua_han", nhan: "Có quá hạn", mau: "do" },
  { key: "tra_truoc", nhan: "Trả trước", mau: "xanh" },
];

const CO_MAC_DINH = 50;

/** Dạng xem nhớ theo máy (chung hai bên phải trả, phải thu). */
type Dang = "bang" | "bieu";
const KHOA_XEM = "bccn-cach-xem";
function docDang(): Dang {
  try {
    return localStorage.getItem(KHOA_XEM) === "bieu" ? "bieu" : "bang";
  } catch {
    return "bang";
  }
}
/** Biểu đồ vẽ ngần này đối tượng nợ nhiều nhất, còn lại gộp "khác". */
const SO_BIEU = 10;

/** Ô số: 0 thành gạch mờ. Âm chỉ gặp ở Đã thu / Đã trả khi kỳ có hoàn tiền mà không có thu / trả. */
function oSo(n: number): ReactNode {
  if (n === 0) return <span className="lds-mu3">–</span>;
  return n < 0 ? `−${soVN(-n)}` : soVN(n);
}

/** Hôm nay `YYYY-MM-DD` giờ máy — trần của ô ngày chốt (sổ chỉ chốt việc đã xảy ra). */
function homNayISO(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return d && m && y ? `${d}/${m}/${y}` : iso;
}

/** Tên kỳ do người chốt tự đặt; tên máy tự sinh ("Kỳ dd/mm/yyyy–…", "Kỳ hiện tại …") thì bỏ, vì
 *  khoảng ngày đã hiện ngay bên cạnh. */
function tenRieng(k: CongNoKyRow): string | null {
  if (k.dang_dien_ra || !k.ten) return null;
  return /^Kỳ \d{2}\/\d{2}\/\d{4}–\d{2}\/\d{2}\/\d{4}$/.test(k.ten) ? null : k.ten;
}

const CHU_TRANG_THAI_KY = (k: CongNoKyRow) =>
  k.dang_dien_ra ? "đang mở" : k.da_khoa ? "đã chốt" : k.khoa_mot_phan ? "chốt một phần" : "đã mở lại";

/** Nút kỳ chốt — cùng dáng nút kỳ của thanh lọc chung, nhưng chỉ chọn trong các KỲ KẾ TOÁN (kỳ do lần
 *  chốt sổ quyết định), không có Tháng này / Tuỳ chọn: sổ công nợ đối chiếu theo kỳ đã chốt. */
function NutKyChot({ ky, kyList, onKy }: { ky: Ky; kyList: CongNoKyRow[]; onKy: (k: Ky) => void }) {
  const [mo, setMo] = useState(false);
  const vung = useRef<HTMLDivElement>(null);
  useDongKhiRaNgoai(vung, mo, () => setMo(false));
  const dang = kyList.find((k) => k.tu_ngay === ky.tu && k.den_ngay === ky.den);
  const ten = dang ? tenRieng(dang) : null;
  return (
    <div className="tl-neo" ref={vung}>
      <button type="button" className={`tl-nut tl-nut--ky${mo ? " is-mo" : ""}`} aria-haspopup="dialog"
        aria-expanded={mo} aria-label={`Kỳ kế toán: ${nhanKy(ky)}`} onClick={() => setMo(!mo)}>
        <CalendarDays size={15} aria-hidden="true" />
        <span>{ten ?? nhanKy(ky)}</span>
        {ten && <span className="tl-nut__phu">{nhanKy(ky)}</span>}
        <ChevronDown size={15} aria-hidden="true" className="tl-nut__mui" />
      </button>
      {mo && (
        <LopNoi className="tl-pop--ky" onDong={() => setMo(false)}>
          <div role="dialog" aria-label="Kỳ kế toán">
            <div className="tl-nhom">Kỳ kế toán</div>
            <div role="radiogroup" aria-label="Kỳ">
              {kyList.map((k) => {
                const chon = k.tu_ngay === ky.tu && k.den_ngay === ky.den;
                const r = tenRieng(k);
                return (
                  <button key={`${k.tu_ngay}_${k.den_ngay}`} type="button" role="radio" aria-checked={chon}
                    className={`tl-dong tl-dong--radio${chon ? " on" : ""}`} title={r ? nhanKy({ tu: k.tu_ngay, den: k.den_ngay }) : undefined}
                    onClick={() => {
                      onKy({ tu: k.tu_ngay, den: k.den_ngay });
                      setMo(false);
                    }}>
                    <span className="tl-dong__dau" aria-hidden="true" />
                    {r ?? nhanKy({ tu: k.tu_ngay, den: k.den_ngay })}
                    <em>{CHU_TRANG_THAI_KY(k)}</em>
                  </button>
                );
              })}
            </div>
          </div>
        </LopNoi>
      )}
    </div>
  );
}

/** Cột lưới: `w` bề rộng (cột cuối Ghi chú co giãn thì bỏ), `n` canh phải. */
interface CotBC extends CotLuoi {
  w?: number;
  n?: boolean;
}

type LocBC = { tuoi: string | null };

export function BaoCaoCongNoPage({
  ben,
  ky,
  onKy,
  navigate,
}: {
  ben: "receivables" | "payables";
  /** Kỳ do VỎ giữ (`BaoCaoKeToanPage`) — để đổi tab không mất kỳ đang chọn. */
  ky: Ky;
  onKy: (ky: Ky) => void;
  navigate?: NavigateFn;
}) {
  const { token } = useAuth();
  const can = useCan();
  const c = CHU[ben];
  // Khoá/mở kỳ là quyền THAO TÁC riêng của `bao_cao_cong_no` (04/09/2026), tách khỏi Xem.
  const canKhoaSo = can("bao_cao_cong_no", "update");
  // Hai sổ khoá ĐỘC LẬP — chốt phải trả không kéo theo phải thu.
  const phanHe: "phai_thu" | "phai_tra" = ben === "receivables" ? "phai_thu" : "phai_tra";

  const [data, setData] = useState<BaoCaoCongNo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dangXuat, setDangXuat] = useState<"tong_hop" | "chi_tiet" | null>(null);
  const [dang, setDang] = useState<Dang>(docDang);
  const doiDang = (v: Dang) => {
    if (v === dang) return;
    // Hai dạng tải khác trang/cỡ/thứ tự: bỏ số của dạng cũ để không vẽ nhầm trong lúc tải.
    setData(null);
    setDang(v);
    try {
      localStorage.setItem(KHOA_XEM, v);
    } catch {
      /* không nhớ được thì thôi */
    }
  };

  // Bộ lọc — đổi bên (phải trả ↔ phải thu) thì về mặc định: hai sổ khác đối tượng.
  const [the, setThe] = useState<CongNoThe>("all");
  const [tuoi, setTuoi] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(CO_MAC_DINH);
  useEffect(() => {
    // Số của bên kia không được hiện dưới nhãn bên này trong lúc tải.
    setData(null);
    setThe("all");
    setTuoi(null);
    setQ("");
    setPage(1);
  }, [ben]);
  const qTre = useDebounced(q.trim());
  useEffect(() => setPage(1), [the, tuoi, qTre, ky.tu, ky.den, size]);

  // Ngăn sổ chi tiết. Giữ cả TÊN + MÃ vừa bấm để hiện ngay lúc đang tải; `id` có thể `null` (dòng
  // "ngoài danh mục") nên không dùng nó làm cờ đóng/mở.
  const [xemSo, setXemSo] = useState<{ id: number | null; ten: string; ma: string | null; tab: TabSo } | null>(null);
  useEffect(() => setXemSo(null), [ben]);

  // Khoá kỳ
  const [kyList, setKyList] = useState<CongNoKyRow[]>([]);
  const [khoaOpen, setKhoaOpen] = useState(false);
  const [khoaHanhDong, setKhoaHanhDong] = useState<"khoa" | "mo">("khoa");
  const [khoaTu, setKhoaTu] = useState("");
  const [khoaDen, setKhoaDen] = useState("");
  const [khoaTen, setKhoaTen] = useState("");
  const [khoaBusy, setKhoaBusy] = useState(false);
  const [khoaError, setKhoaError] = useState<string | null>(null);

  const loadKyList = useCallback(() => {
    if (!token) return;
    api.accounting.congNoKyList(token, phanHe).then(setKyList).catch(() => {});
  }, [token, phanHe]);
  useEffect(loadKyList, [loadKyList]);

  // NHẢY VỀ KỲ HIỆN TẠI một lần khi biết danh sách kỳ thật (04/09/2026): giá trị đầu ở vỏ là
  // "đầu tháng → hôm nay", gần như chắc chắn không khớp kỳ nào. Sau đó người dùng tự chọn.
  const daNhayKy = useRef(false);
  useEffect(() => {
    if (daNhayKy.current || kyList.length === 0) return;
    daNhayKy.current = true;
    if (!kyList.some((k) => k.tu_ngay === ky.tu && k.den_ngay === ky.den)) {
      onKy({ tu: kyList[0].tu_ngay, den: kyList[0].den_ngay });
    }
  }, [kyList, ky.tu, ky.den, onKy]);

  // TRẠNG THÁI KHOÁ của đúng kỳ đang xem — hỏi máy chủ, không tự suy từ `kyList` (04/09/2026).
  const [trangThaiKhoa, setTrangThaiKhoa] = useState<CongNoKhoaSoTrangThai | null>(null);
  const kyHienTaiDaKhoa = trangThaiKhoa?.da_khoa ?? false;
  const kyKhoaMotPhan = trangThaiKhoa?.khoa_mot_phan ?? false;
  const loadTrangThaiKhoa = useCallback(() => {
    if (!token) return;
    api.accounting
      .congNoKhoaSoTrangThai(token, { tuNgay: ky.tu, denNgay: ky.den, phanHe })
      .then(setTrangThaiKhoa)
      .catch(() => setTrangThaiKhoa(null));
  }, [token, ky.tu, ky.den, phanHe]);
  useEffect(loadTrangThaiKhoa, [loadTrangThaiKhoa]);

  // Câu trả lời cũ về muộn (gõ nhanh, đổi kỳ liên tục) bị bỏ.
  const luot = useRef(0);
  const load = useCallback(() => {
    if (!token) return;
    const l = ++luot.current;
    setLoading(true);
    setError(null);
    const bieu = dang === "bieu";
    api.accounting
      .baoCaoCongNo(token, ben, {
        tuNgay: ky.tu, denNgay: ky.den, q: qTre, roTuoi: tuoi, the,
        page: bieu ? 1 : page, size: bieu ? SO_BIEU : size, sapXep: bieu ? "con_no" : undefined,
      })
      .then((d) => {
        if (l === luot.current) setData(d);
      })
      .catch((cause) => {
        if (l !== luot.current) return;
        setData(null);
        setError(cause instanceof ApiError ? cause.message : "Không tải được báo cáo công nợ.");
      })
      .finally(() => {
        if (l === luot.current) setLoading(false);
      });
  }, [token, ben, ky.tu, ky.den, qTre, tuoi, the, page, size, dang]);
  useEffect(load, [load]);

  async function xuatExcel(chiTiet = false) {
    if (!token) return;
    setDangXuat(chiTiet ? "chi_tiet" : "tong_hop");
    try {
      const { url, ten } = await api.accounting.baoCaoCongNoXlsx(token, ben, { tuNgay: ky.tu, denNgay: ky.den }, chiTiet);
      const a = document.createElement("a");
      a.href = url;
      a.download = ten;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Không xuất được file.");
    } finally {
      setDangXuat(null);
    }
  }

  // NGÀY BẮT ĐẦU của kỳ chốt tiếp theo — máy chủ tính sẵn ở mục "kỳ hiện tại", giao diện không cộng ngày.
  const mocChotTiepTheo = kyList.find((k) => k.dang_dien_ra)?.tu_ngay ?? null;
  const tenGoiY = khoaTu && khoaDen ? `Kỳ ${fmtDate(khoaTu)}–${fmtDate(khoaDen)}` : "";

  function openKhoaModal() {
    loadKyList();
    const daKhoa = kyHienTaiDaKhoa;
    setKhoaHanhDong(daKhoa ? "mo" : "khoa");
    // CHỐT: nối tiếp sau kỳ trước (chọn lệch là chồng kỳ cũ hoặc hở ngày). MỞ: đúng nguyên kỳ đang xem.
    setKhoaTu(daKhoa ? ky.tu : (mocChotTiepTheo ?? ky.tu));
    setKhoaDen(ky.den);
    // Để trống: tên gợi ý bám theo CHÍNH khoảng sắp chốt, đổi theo khi sửa ngày.
    setKhoaTen("");
    setKhoaError(null);
    setKhoaOpen(true);
  }

  async function saveKhoa() {
    if (!token) return;
    if (!khoaTu || !khoaDen) {
      setKhoaError("Vui lòng chọn cả ngày bắt đầu và kết thúc.");
      return;
    }
    if (khoaDen < khoaTu) {
      setKhoaError("Ngày đến phải lớn hơn hoặc bằng ngày từ.");
      return;
    }
    setKhoaBusy(true);
    setKhoaError(null);
    try {
      await api.accounting.setCongNoKhoaSo(token, {
        phan_he: phanHe,
        tu_ngay: khoaTu,
        den_ngay: khoaDen,
        hanh_dong: khoaHanhDong,
        ten: khoaHanhDong === "khoa" ? khoaTen.trim() || tenGoiY || null : null,
      });
      loadKyList();
      loadTrangThaiKhoa();
      load();
      setKhoaOpen(false);
    } catch (e) {
      setKhoaError(e instanceof ApiError ? e.message : "Không thực hiện được thao tác.");
    } finally {
      setKhoaBusy(false);
    }
  }

  // KỲ ĐÃ CÓ KỲ CHỐT SAU ⇒ NIÊM VĨNH VIỄN (04/09/2026). Máy chủ tính sẵn `co_the_mo`; giao diện mờ nút.
  const kyDangChon = kyList.find((k) => k.tu_ngay === ky.tu && k.den_ngay === ky.den);
  const chanMoKy = kyHienTaiDaKhoa && kyDangChon != null && !kyDangChon.co_the_mo;
  const kyChan = chanMoKy
    ? kyList.filter((k) => !k.dang_dien_ra && k.den_ngay > ky.den).sort((a, b) => a.den_ngay.localeCompare(b.den_ngay))[0]
    : undefined;

  // ---------- lưới ----------
  const luoi = useCauHinhLuoi(`bao-cao-cong-no:${ben}`);
  // Dải mốc giữ lại qua lúc đang tải (đổi Bảng ↔ Biểu đồ bỏ số cũ) để cột và chip lọc tuổi không
  // chớp thành mã thô.
  const agingNho = useRef(data?.aging ?? []);
  if (data?.aging?.length) agingNho.current = data.aging;
  const aging = agingNho.current;
  const cotDay: CotBC[] = [
    { key: "ma", label: "Mã", coDinh: true, w: 84 },
    { key: "ten", label: c.doiTac, coDinh: true, w: 250 },
    { key: "dau", label: "Còn nợ đầu kỳ", n: true, w: 118 },
    { key: "tang", label: c.tang, n: true, w: 118 },
    { key: "giam", label: c.giam, n: true, w: 118 },
    { key: "cuoi", label: "Còn nợ cuối kỳ", n: true, w: 124 },
    // Sáu mốc tuổi nợ lấy nhãn từ máy chủ (`AGING_BUCKETS`) — đừng gõ lại số ngày ở đây.
    ...(aging.length
      ? aging.map((b): CotBC => ({ key: `ro:${b.key}`, label: nhanMoc(b.label), n: true, w: 114 }))
      : []),
    { key: "ghi_chu", label: "Ghi chú" },
  ];
  const cotHien = luoi.rongHien(luoi.xep(cotDay).filter((x) => !luoi.an.has(x.key)));
  const rows = data?.items ?? [];
  const tong = data?.tong ?? null;
  const total = data?.total ?? 0;
  const coLoc = the !== "all" || tuoi != null || !!qTre;

  const mo = (d: CongNoDong, tab: TabSo = "so") => setXemSo({ id: d.doi_tuong_id, ten: d.ten, ma: d.ma, tab });
  const dangChon = (d: CongNoDong) => xemSo != null && xemSo.id === d.doi_tuong_id && xemSo.ten === d.ten;
  const viTri = xemSo ? rows.findIndex(dangChon) : -1;

  const xoaLoc = () => {
    setThe("all");
    setTuoi(null);
    setQ("");
  };

  const ghiChu = (truoc: number, dauTruoc: number, ngoai: boolean, coMa: boolean) => {
    const p: ReactNode[] = [];
    if (truoc > 0) p.push(<span key="t">{`${c.traTruoc} ${soVN(truoc)}`}</span>);
    if (dauTruoc > 0) p.push(<span key="d" className="lds-mu">{`đầu kỳ ${c.traTruoc} ${soVN(dauTruoc)}`}</span>);
    if (ngoai) p.push(<span key="n" className="lds-mu">ngoài danh mục</span>);
    else if (!coMa) p.push(<span key="m" className="lds-mu">chưa có mã</span>);
    return <span className="bccn-ghi">{p}</span>;
  };

  const oDong = (x: CotBC, d: CongNoDong) => {
    const s = chieuDong(ben, d);
    switch (x.key) {
      case "ma":
        return <td key={x.key} className="lds-mu">{d.ma ?? "–"}</td>;
      case "ten":
        return <td key={x.key} title={d.ten}>{d.ten}</td>;
      case "dau":
        return <td key={x.key} className="n">{oSo(s.dau)}</td>;
      case "tang":
        return <td key={x.key} className="n">{oSo(s.tang)}</td>;
      case "giam":
        return <td key={x.key} className="n">{oSo(s.giam)}</td>;
      case "cuoi":
        return <td key={x.key} className="n">{oSo(s.cuoi)}</td>;
      case "ghi_chu":
        return <td key={x.key}>{ghiChu(s.truoc, s.dauTruoc, d.doi_tuong_id == null, !!d.ma)}</td>;
      default: {
        const k = x.key.slice(3);
        const v = d.aging?.[k]?.amount ?? 0;
        // Mốc trễ có tiền: chữ đỏ, bấm mở ngăn ở các khoản còn nợ.
        if (v > 0 && k !== aging[0]?.key) {
          return (
            <td key={x.key} className="n lds-do">
              <button type="button" className="kt-so-nut" aria-label={`Xem các khoản còn nợ của ${d.ten}`}
                onClick={(e) => {
                  e.stopPropagation();
                  mo(d, "dot");
                }}
                onKeyDown={(e) => e.stopPropagation()}>
                {soVN(v)}
              </button>
            </td>
          );
        }
        return <td key={x.key} className="n">{oSo(v)}</td>;
      }
    }
  };

  const oCong = (x: CotBC) => {
    if (!tong || !data) return <td key={x.key} />;
    const s = chieuDong(ben, tong);
    switch (x.key) {
      case "ma":
        return null;
      case "ten":
        return null;
      case "dau":
        return <td key={x.key} className="n">{oSo(s.dau)}</td>;
      case "tang":
        return <td key={x.key} className="n">{oSo(s.tang)}</td>;
      case "giam":
        return <td key={x.key} className="n">{oSo(s.giam)}</td>;
      case "cuoi":
        return <td key={x.key} className="n">{oSo(s.cuoi)}</td>;
      case "ghi_chu":
        return <td key={x.key}>{ghiChu(s.truoc, s.dauTruoc, false, true)}</td>;
      default: {
        const k = x.key.slice(3);
        const v = data.tong_aging?.[k] ?? 0;
        return <td key={x.key} className={`n${v > 0 && k !== aging[0]?.key ? " lds-do" : ""}`}>{oSo(v)}</td>;
      }
    }
  };

  // Dòng Cộng: ô nhãn trải qua các cột đầu đứng liền nhau (Mã, tên) còn đang hiện.
  const soCotNhan = Math.max(1, cotHien.findIndex((x) => x.key !== "ma" && x.key !== "ten"));

  const muc: MucLocNhanh[] = THE.map((t) => ({ key: t.key, label: t.nhan, mau: t.mau, count: data?.dem_the?.[t.key] }));
  const dieuKien: DieuKien<LocBC>[] = [
    dkTheoTab<LocBC>({
      tabs: THE.map((t) => ({ id: t.key, nhan: t.nhan, so: data?.dem_the?.[t.key] })),
      tatCa: "all",
      dang: the,
      dat: (id) => setThe(id as CongNoThe),
      anKhoi: true,
    }),
    {
      khoa: "tuoi", nhan: "Tuổi nợ", icon: Hourglass, kieu: "mot",
      giaTri: aging.map((b) => ({ value: b.key, nhan: nhanMoc(b.label), so: b.count })),
      doc: (l) => l.tuoi ?? undefined,
      ghi: (l, v) => ({ ...l, tuoi: v ?? null }),
    },
  ];

  return (
    <main className="kt-trang lds bccn">
      <header className="lds-dau">
        <h1 className="lds-dau__ten">{c.tieuDe}</h1>
        <div className="lds-dau__nut">
          <Button variant="ghost" onClick={() => void xuatExcel()} disabled={dangXuat != null || !data}
            title="Sổ tổng hợp của kỳ ra file .xlsx đúng mẫu MISA">
            <Icon name="table" size={14} /> {dangXuat === "tong_hop" ? "Đang xuất…" : "Xuất Excel"}
          </Button>
          <Button variant="ghost" onClick={() => void xuatExcel(true)} disabled={dangXuat != null || !data}
            title="Sổ chi tiết mọi đối tượng trong kỳ: từng chứng từ, tài khoản đối ứng, số dư luỹ kế">
            <Icon name="fileText" size={14} /> {dangXuat === "chi_tiet" ? "Đang xuất…" : "Xuất Excel chi tiết"}
          </Button>
          {canKhoaSo && (
            <Button variant="secondary" onClick={openKhoaModal} disabled={chanMoKy}
              title={
                chanMoKy
                  ? `Kỳ này đã niêm vì đã có kỳ chốt sau nó${kyChan ? ` (${kyChan.ten})` : ""}. Sổ đóng rồi thì không mở lại được nữa.`
                  : "Khoá hoặc mở sổ kỳ kế toán"
              }>
              <Icon name={kyHienTaiDaKhoa ? "lock" : "lockOpen"} size={14} />
              {kyHienTaiDaKhoa ? "Mở khoá kỳ" : kyKhoaMotPhan ? "Chốt nốt kỳ" : "Khoá kỳ"}
            </Button>
          )}
        </div>
      </header>

      <section className="lds-loc">
        <LocNhanhTrangThai muc={muc} dang={the} onChon={(k) => setThe(k as CongNoThe)} />
        <div className="lds-loc__thanh tl-thanh" role="search">
          <OTim value={q} onChange={setQ} placeholder={c.timGoiY} ariaLabel={c.timGoiY} />
          <NutKyChot ky={ky} kyList={kyList} onKy={onKy} />
          {kyHienTaiDaKhoa ? (
            <ChipTT mau="la" title={chanMoKy ? "Đã chốt sổ và đã niêm: có kỳ chốt sau nó, không mở lại được." : "Mọi ngày trong kỳ đều đã chốt sổ"}>
              {chanMoKy ? "Đã chốt, đã niêm" : "Đã chốt"}
            </ChipTT>
          ) : kyKhoaMotPhan ? (
            <ChipTT mau="cam" title="Kỳ này có ngày đã chốt, có ngày chưa — thường do một kỳ chốt cũ chỉ phủ một phần.">
              Chốt một phần
            </ChipTT>
          ) : (
            <ChipTT mau="xanh" title="Kỳ đang mở, chưa chốt sổ">Chưa chốt</ChipTT>
          )}
          <ThanhLoc dieuKien={dieuKien} loc={{ tuoi }} onLoc={(l) => setTuoi(l.tuoi)} onXoaHet={xoaLoc} />
          <div className="lds-loc__phai">
            <NhomNut giaTri={dang} luaChon={[["bang", "Bảng"], ["bieu", "Biểu đồ"]]} onDoi={doiDang} />
            {dang === "bang" && <ChonCot cot={cotDay} {...luoi.chonCot} />}
          </div>
        </div>
      </section>

      {dang === "bieu" ? (
        <div className={loading ? "bccn-dang-tai" : undefined} aria-busy={loading || undefined}>
          {data && rows.length > 0 ? (
            <BieuDoCongNo key={ben} ben={ben} data={data} chu={c} coLoc={coLoc} onMo={mo}
              onMoc={(k) => {
                setTuoi(k);
                doiDang("bang");
              }}
              onCoQuaHan={() => setThe("qua_han")} />
          ) : (
            <p className="lds-sheet lds-trong bccn-bd__rong">
              {loading && !error ? "Đang tải…" : error ? (
                <span role="alert">
                  <span className="lds-do">{error}</span>{" "}
                  <button type="button" className="lds-lk" onClick={load}>Thử lại</button>
                </span>
              ) : coLoc ? (
                <>
                  {`Không có ${c.donVi} nào khớp điều kiện đang lọc.`}{" "}
                  <button type="button" className="lds-lk" onClick={xoaLoc}>Xoá bộ lọc</button>
                </>
              ) : "Kỳ này không có phát sinh nào."}
            </p>
          )}
          {data && rows.length > 0 && (
            <p className="bccn-chan lds-mu">
              {`Đơn vị biểu đồ: triệu đồng. Còn nợ chia theo hạn tính tại ngày cuối kỳ ${fmtDate(data.den_ngay)}.`}
            </p>
          )}
        </div>
      ) : (
      <div className="lds-sheet" aria-busy={loading || undefined}>
        <CuonLuoi ghim={luoi.soGhim(cotHien)}>
          <table className="lds-g" style={{ minWidth: rongLuoi(cotHien, 200) }}>
            <colgroup>
              {cotHien.map((x) => <col key={x.key} style={x.w ? { width: x.w } : undefined} />)}
            </colgroup>
            <thead>
              <tr>
                {cotHien.map((x) => (
                  <th key={x.key} className={x.n ? "n" : undefined}>{x.label}{luoi.keo(x.key)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* Dòng Cộng đứng ĐẦU (phương án C): Σ của MỌI dòng khớp bộ lọc, máy chủ cộng — không chỉ trang này. */}
              {rows.length > 0 && tong ? (
                <tr className="lds-cong lds-nhom">
                  <td className="lead" colSpan={soCotNhan}>
                    <span className="lds-dinh-trai">{`Cộng ${soVN(total)} ${c.donVi}`}</span>
                  </td>
                  {cotHien.slice(soCotNhan).map(oCong)}
                </tr>
              ) : null}
              {loading && rows.length === 0 && !error ? (
                <EmptyRow colSpan={cotHien.length} trangThai="dang-tai" />
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={cotHien.length} className="lds-trong">
                    {error ? (
                      <span role="alert">
                        <span className="lds-do">{error}</span>{" "}
                        <span className="lds-mu">Các con số đang để trống, không phải bằng 0.</span>{" "}
                        <button type="button" className="lds-lk" onClick={load}>Thử lại</button>
                      </span>
                    ) : coLoc ? (
                      <>
                        {`Không có ${c.donVi} nào khớp điều kiện đang lọc.`}{" "}
                        <button type="button" className="lds-lk" onClick={xoaLoc}>Xoá bộ lọc</button>
                      </>
                    ) : (
                      "Kỳ này không có phát sinh nào."
                    )}
                  </td>
                </tr>
              ) : (
                rows.map((d) => (
                  <tr key={`${d.doi_tuong_id ?? "khac"}-${d.ten}`}
                    className={`lds-dong${dangChon(d) ? " is-chon" : ""}`} tabIndex={0}
                    aria-label={`Xem sổ chi tiết của ${d.ten}`}
                    onClick={() => mo(d)} onKeyDown={(e) => diChuyen(e, () => mo(d))}>
                    {cotHien.map((x) => oDong(x, d))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CuonLuoi>
        {total > 0 && (
          <PhanTrangDayDu trang={page} size={size} tong={total} soDong={rows.length} onTrang={setPage}
            onSize={setSize} loading={loading} donVi={c.donVi} ariaLabel="Phân trang sổ tổng hợp công nợ" />
        )}
        {data && (
          <p className="bccn-chan lds-mu">
            {`Đơn vị: đồng. Còn nợ chia theo hạn tính tại ngày cuối kỳ ${fmtDate(data.den_ngay)}, in lại kỳ cũ vẫn ra đúng số cũ.`}
          </p>
        )}
      </div>
      )}

      <ConfirmDialog
        open={khoaOpen}
        title={khoaHanhDong === "khoa" ? "Khoá kỳ kế toán công nợ" : "Mở lại kỳ kế toán công nợ"}
        confirmLabel={khoaHanhDong === "khoa" ? "Khoá sổ" : "Mở sổ"}
        cancelLabel="Huỷ"
        busy={khoaBusy}
        error={khoaError}
        confirmDisabled={!khoaTu || !khoaDen}
        onConfirm={saveKhoa}
        onCancel={() => setKhoaOpen(false)}
      >
        <div className="kho-khoa">
          <div className="kho-khoa__field">
            <span className="kho-khoa__label">Hành động</span>
            <div className="kho-khoa__seg">
              {([["khoa", "Khoá kỳ"], ["mo", "Mở kỳ"]] as const).map(([id, label]) => (
                <button key={id} type="button"
                  className={`kho-khoa__seg-btn${khoaHanhDong === id ? (id === "khoa" ? " is-khoa" : " is-mo") : ""}`}
                  onClick={() => setKhoaHanhDong(id)}>
                  <Icon name={id === "mo" ? "lockOpen" : "lock"} size={14} /> {label}
                </button>
              ))}
            </div>
          </div>

          <div className="kho-khoa__row">
            <div className="kho-khoa__field">
              <label className="kho-khoa__label" htmlFor="bccn-khoa-tu">
                Từ ngày <em className="kho-khoa__auto">{khoaHanhDong === "khoa" ? "nối tiếp kỳ trước" : "đúng kỳ đang chọn"}</em>
              </label>
              {/* Ô ngày đầu KHOÁ ở cả hai hành động (04/09/2026): khoá thì máy chủ nối tiếp, mở thì mở nguyên kỳ. */}
              <ChonNgay id="bccn-khoa-tu" aria-label="Từ ngày" className="input" value={khoaTu} onChange={() => {}} readOnly
                title={
                  khoaHanhDong === "khoa"
                    ? "Kỳ mới luôn bắt đầu ngay sau ngày chốt cuối cùng — không đè lên kỳ đã chốt, cũng không để hở ngày nào."
                    : "Mở nguyên kỳ đang chọn — muốn mở kỳ khác thì chọn kỳ đó trước."
                } />
            </div>
            <div className="kho-khoa__field">
              <label className="kho-khoa__label" htmlFor="bccn-khoa-den">Đến ngày</label>
              <ChonNgay id="bccn-khoa-den" aria-label="Đến ngày" className="input" value={khoaDen}
                readOnly={khoaHanhDong === "mo"} min={khoaTu || undefined} max={homNayISO()}
                onChange={(v) => setKhoaDen(v)}
                title={khoaHanhDong === "mo" ? "Mở nguyên kỳ đang chọn — không mở nửa kỳ." : undefined} />
            </div>
          </div>

          {khoaHanhDong === "khoa" && (
            <div className="kho-khoa__field">
              <label className="kho-khoa__label" htmlFor="bccn-khoa-ten">Tên kỳ (tuỳ chọn)</label>
              <input id="bccn-khoa-ten" className="input" value={khoaTen} maxLength={120}
                onChange={(e) => setKhoaTen(e.target.value)} placeholder={tenGoiY || "vd: Chốt kỳ 1 2026"} />
            </div>
          )}

          <p className={`kho-khoa__note kho-khoa__note--${khoaHanhDong}`}>
            <Icon name={khoaHanhDong === "mo" ? "lockOpen" : "lock"} size={14} />
            <span>
              {khoaHanhDong === "khoa"
                ? "Hoá đơn và chứng từ thanh toán trong khoảng này thuộc kỳ đã chốt — hệ thống lưu số dư để đối chiếu MISA và chặn sửa dữ liệu đã chốt."
                : "Mở lại nguyên kỳ đang chọn để ghi sổ hoặc điều chỉnh chứng từ. Chỉ kỳ chốt mới nhất mở được; kỳ đã có kỳ chốt sau nó thì niêm vĩnh viễn. Thao tác mở sổ được ghi lại trong nhật ký."}
            </span>
          </p>
        </div>
      </ConfirmDialog>

      {xemSo && (
        <SoChiTietDrawer
          ben={ben}
          doiTuongId={xemSo.id}
          tenLui={xemSo.ten}
          ma={xemSo.ma}
          tabDau={xemSo.tab}
          tuNgay={ky.tu}
          denNgay={ky.den}
          trangThaiKy={kyHienTaiDaKhoa ? "Đã chốt" : kyKhoaMotPhan ? "Chốt một phần" : "Chưa chốt"}
          onClose={() => setXemSo(null)}
          len={viTri > 0 ? () => mo(rows[viTri - 1], xemSo.tab) : undefined}
          xuong={viTri >= 0 && viTri < rows.length - 1 ? () => mo(rows[viTri + 1], xemSo.tab) : undefined}
          navigate={navigate}
        />
      )}
    </main>
  );
}
