// Bốn tab bảng của ngăn mặt hàng màn Tồn kho — Lô tồn, Lịch sử nhập xuất, Lịch sử chuyển kho, Lịch sử
// sửa (04/11/2026). Mỗi tab dùng đúng khuôn bảng chính: ô tìm, kỳ, nút Lọc, nút Cột; lưới kéo mép đổi
// độ rộng và ghim cột (nhớ riêng từng tab); chân PhanTrangDayDu. Lọc + cắt trang ở máy chủ
// (`kho_ngan_lich_su.py`). Cột ĐVT như bảng chính: mỗi dòng một ô chọn đơn vị, mặc định theo đơn vị
// dòng trên bảng đang xem; đổi ở dòng nào thì số dòng đó đổi theo (số chia hệ số, đơn giá nhân hệ số,
// tiền giữ nguyên). Ô số lượng chỉ còn số, đơn vị nằm ở cột ĐVT.
import { MapPin, Tags, User, Warehouse } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { api, ApiError } from "../../api/client";
import type {
  ChuyenKhoPage,
  ChuyenKhoRow,
  GiaTriChonNgan,
  LichSuSuaDoi,
  LichSuSuaRow,
  LocNganMatHang,
  NhapXuatRow,
  StockLot,
  StockMaterialHistoryPage,
  TabLichSuMatHang,
} from "../../api/client";
import { CodeLink } from "../../components/CodeLink";
import {
  ChonCot, CuonLuoi, OTim, rongLuoi, useCauHinhLuoi, type CauHinhLuoi, type CotLuoi,
} from "../../components/LuoiDs";
import { PhanTrangDayDu } from "../../components/PhanTrangDayDu";
import { nhanKho } from "../../lib/khoGiay";
import { fmtDateISO, fmtDateTime, money } from "../../utils/format";
import { fmtQty, todayISO } from "../khoShared";
import { tenDonVi, useNapTenDonVi } from "../tenDonVi";
import { ThanhLoc } from "../thanh-loc/ThanhLoc";
import { thamSoKy, type KyDS } from "../thanh-loc/ky-danh-sach";
import type { DieuKien } from "../thanh-loc/thanh-loc";
import { Chenh, LOP_VIEC, OGhiChu } from "./BangChuyenKho";
import { loChuaGiaGoc, NhanChuaGiaGoc } from "./oLo";

type TabBang = TabLichSuMatHang;
type KhoaLoc = "viec" | "nguoi" | "vi_tri" | "kho_tu" | "kho_den";
export type LocDK = Partial<Record<KhoaLoc, string[]>>;
export interface LocTab { q: string; ky: KyDS; loc: LocDK }

/** Mốc kỳ của từng tab — một mốc nên nút Kỳ không bày phần "Tính theo". */
const MOC: Record<TabBang, [string, string][]> = {
  lo_ton: [["nhap", "Ngày nhập"]],
  nhap_xuat: [["ngay", "Ngày"]],
  chuyen: [["ngay", "Ngày chuyển"]],
  sua: [["ngay", "Ngày sửa"]],
};

export const locTabTrong = (tab: TabBang): LocTab => ({ q: "", ky: { loai: "tat_ca", moc: MOC[tab][0][0] }, loc: {} });

/** Tham số máy chủ của tab. `qGui` = chữ ô tìm đã dừng gõ (cha hoãn để khỏi gọi theo từng phím). */
export function thamSoTab(l: LocTab, qGui: string): LocNganMatHang {
  const k = thamSoKy(l.ky) as { tu_ngay?: string; den_ngay?: string };
  return { q: qGui.trim() || undefined, tu_ngay: k.tu_ngay, den_ngay: k.den_ngay, ...l.loc };
}

/** Đơn vị xem được của dòng tồn (`he_so` = số đơn vị gốc trong 1 đơn vị này) và đơn vị mặc định. */
export interface DvNgan {
  ds: { ma: string; ten: string; he_so: number }[];
  ma: string | null;
}

/** Đơn vị một dòng bảng đang xem. */
interface DvDong { heSo: number; ten: string }

const tru = <span className="lds-mu3">–</span>;

/** Đơn vị từng dòng người xem đã đổi (khoá dòng → mã đơn vị); vắng = mặc định `dv.ma`, rồi gốc. */
function useDvDong() {
  const [dvDong, setDvDong] = useState<Record<string, string>>({});
  const maCua = (k: string, dv: DvNgan) => dvDong[k] ?? dv.ma ?? dv.ds[0]?.ma ?? "";
  return {
    dvCua(k: string, dv: DvNgan, tenGoc: string): DvDong {
      const c = dv.ds.find((d) => d.ma === maCua(k, dv)) ?? null;
      const heSo = c && c.he_so > 0 ? c.he_so : 1;
      return { heSo, ten: c && heSo !== 1 ? c.ten : tenGoc };
    },
    /** Ô ĐVT: ô chọn khi có đơn vị quy được, không thì tên đơn vị gốc. */
    oDv(k: string, dv: DvNgan, tenGoc: string): ReactNode {
      if (dv.ds.length < 2) return tenGoc || tru;
      return (
        <select className="tkh-dvt-chon" aria-label="Xem dòng này theo đơn vị" value={maCua(k, dv)}
          onChange={(e) => setDvDong((cu) => ({ ...cu, [k]: e.target.value }))}>
          {dv.ds.map((d) => <option key={d.ma} value={d.ma}>{d.ten}</option>)}
        </select>
      );
    },
  };
}

type Cot<T> = CotLuoi & { w?: number; n?: boolean; o: (r: T) => ReactNode; lop?: (r: T) => string | undefined };

/** `trong`: chưa có dòng nào thì vẫn giữ hàng tiêu đề cột, câu báo trống nằm giữa một dòng cao (khuôn chung
 *  `td.lds-trong` của lưới) — không để câu chữ trần dính sát mép dưới thanh lọc. */
function Luoi<T>({ cot, luoi, rows, khoa, trong }: {
  cot: Cot<T>[]; luoi: CauHinhLuoi; rows: T[]; khoa: (r: T) => string | number; trong?: ReactNode;
}) {
  const hien = luoi.rongHien(luoi.xep(cot).filter((c) => !luoi.an.has(c.key)));
  return (
    <CuonLuoi ghim={luoi.soGhim(hien)}>
      <table className="lds-g" style={{ minWidth: rongLuoi(hien) }}>
        <colgroup>{hien.map((c) => <col key={c.key} style={c.w ? { width: c.w } : undefined} />)}</colgroup>
        <thead>
          <tr>{hien.map((c) => <th key={c.key} className={c.n ? "n" : undefined}>{c.label}{luoi.keo(c.key)}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={hien.length || 1} className="lds-trong">{trong}</td></tr>
          )}
          {rows.map((r) => (
            <tr key={khoa(r)}>
              {hien.map((c) => (
                <td key={c.key} className={[c.n ? "n" : "", c.lop?.(r) ?? ""].join(" ").trim() || undefined}>{c.o(r)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </CuonLuoi>
  );
}

const hsd = (v: string | null | undefined) => (v ? fmtDateISO(v) : tru);
const lopHsd = (v: string | null | undefined) => (v && v < todayISO() ? "lds-do" : undefined);

function dkNhieu(khoa: KhoaLoc, nhan: string, icon: DieuKien<LocDK>["icon"], giaTri: GiaTriChonNgan[] | undefined): DieuKien<LocDK> {
  return {
    khoa, nhan, icon, kieu: "nhieu", tim: true,
    giaTri: (giaTri ?? []).map((g) => ({ value: g.value, nhan: g.nhan, so: g.so })),
    doc: (l) => l[khoa] ?? [],
    ghi: (l, v) => ({ ...l, [khoa]: v.length ? v : undefined }),
  };
}

function dieuKien(tab: TabBang, chon: Record<string, GiaTriChonNgan[]>): DieuKien<LocDK>[] {
  if (tab === "lo_ton") return [dkNhieu("vi_tri", "Vị trí", MapPin, chon.vi_tri)];
  if (tab === "chuyen") {
    return [
      dkNhieu("kho_tu", "Từ kho", Warehouse, chon.kho_tu),
      dkNhieu("kho_den", "Sang kho", Warehouse, chon.kho_den),
      dkNhieu("nguoi", "Người chuyển", User, chon.nguoi),
    ];
  }
  return [
    dkNhieu("viec", "Việc", Tags, chon.viec),
    dkNhieu("nguoi", tab === "sua" ? "Người sửa" : "Người làm", User, chon.nguoi),
  ];
}

const TIM: Record<TabBang, string> = {
  lo_ton: "Tìm số phiếu, vị trí, NCC",
  nhap_xuat: "Tìm số phiếu, vị trí",
  chuyen: "Tìm vị trí lấy, vị trí cất",
  sua: "Tìm trong ghi chú",
};
const DON_VI: Record<TabBang, string> = { lo_ton: "lô", nhap_xuat: "lần", chuyen: "lần chuyển", sua: "lần sửa" };
const TRONG: Record<TabBang, string> = {
  lo_ton: "Không còn lô nào tồn cho vật tư này.",
  nhap_xuat: "Chưa có lần nhập, xuất nào cho vật tư này.",
  chuyen: "Chưa có lần chuyển kho nào cho vật tư này.",
  sua: "Chưa ai sửa thông tin vật tư này ở kho.",
};

export function TabBangNgan({
  tab, trang, dem, loading, loc, onLoc, page, size, onPage, onSize, dv, dvtGoc, laGiay, canViewCost,
  canCreate, onBoSungKho, onOpenVoucher, onLuuGhiChu,
}: {
  tab: TabBang;
  /** Trang đúng tab này (null = đang chờ). */
  trang: StockMaterialHistoryPage | null;
  /** Số dòng chưa lọc của tab. */
  dem: number;
  loading: boolean;
  loc: LocTab;
  onLoc: (l: LocTab) => void;
  page: number;
  size: number;
  onPage: (p: number) => void;
  onSize: (n: number) => void;
  dv: DvNgan;
  /** Tên đơn vị gốc của dòng tồn (tờ, kg…). */
  dvtGoc: string;
  laGiay: boolean;
  canViewCost: boolean;
  canCreate: boolean;
  onBoSungKho: (lot: StockLot) => void;
  onOpenVoucher: (voucherId: number) => void;
  onLuuGhiChu: (id: number, ghiChu: string) => Promise<void>;
}) {
  const luoi = useCauHinhLuoi(`kho-ngan-${tab}`);
  const dvd = useDvDong();
  const dvCua = (k: string) => dvd.dvCua(k, dv, dvtGoc);
  const sl = (k: string, n: number | null | undefined, dau = "") => (n == null ? tru : `${dau}${fmtQty(n / dvCua(k).heSo)}`);
  const gia = (k: string, n: number | null | undefined) => (n == null ? "" : money(n * dvCua(k).heSo));
  const oDv = (k: string) => dvd.oDv(k, dv, dvtGoc);

  const cot = cotTheoTab(tab, { sl, gia, dvCua, oDv, laGiay, canViewCost, canCreate, onBoSungKho, onOpenVoucher, onLuuGhiChu, suaDuoc: !!trang?.sua_ghi_chu, lo: trang?.lo ?? [] });
  const coLoc = !!loc.q || loc.ky.loai !== "tat_ca" || Object.values(loc.loc).some((v) => v?.length);
  const xoaLoc = () => onLoc(locTabTrong(tab));
  const rows: unknown[] = trang
    ? tab === "lo_ton" ? trang.lo : tab === "nhap_xuat" ? trang.nhap_xuat : tab === "chuyen" ? trang.chuyen : trang.sua
    : [];

  if (!dem && !coLoc) return <p className="kho-hint">{TRONG[tab]}</p>;
  return (
    <>
      <div className="lds-loc__thanh tl-thanh tkh-ngan-loc" role="search">
        <OTim value={loc.q} onChange={(q) => onLoc({ ...loc, q })} placeholder={TIM[tab]} ariaLabel={TIM[tab]} />
        <ThanhLoc
          ky={loc.ky}
          moc={MOC[tab]}
          onKy={(ky) => onLoc({ ...loc, ky })}
          dieuKien={dieuKien(tab, trang?.chon ?? {})}
          loc={loc.loc}
          onLoc={(l) => onLoc({ ...loc, loc: l })}
          onXoaHet={xoaLoc}
        />
        <ChonCot cot={cot} {...luoi.chonCot} />
      </div>
      {loading && !trang ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
          {Array.from({ length: 4 }).map((_, i) => <span key={i} className="rc-skel" style={{ width: `${90 - i * 12}%` }} />)}
        </div>
      ) : rows.length === 0 ? (
        <Luoi cot={cot as Cot<unknown>[]} luoi={luoi} rows={[]} khoa={() => 0} trong={<>
          Không có dòng nào khớp điều kiện đang lọc.{" "}
          <button type="button" className="lds-lk" onClick={xoaLoc}>Xoá bộ lọc</button>
        </>} />
      ) : tab === "sua" ? (
        <LuoiSua rows={rows as LichSuSuaRow[]} cot={cot as Cot<DongSua>[]} luoi={luoi} />
      ) : (
        <Luoi cot={cot as Cot<unknown>[]} luoi={luoi} rows={rows}
          khoa={(r) => (r as { key?: string; id?: number }).key ?? (r as { id: number }).id} />
      )}
      {trang && trang.tong > 0 && (
        <PhanTrangDayDu trang={page} size={size} tong={trang.tong} soDong={rows.length} onTrang={onPage}
          onSize={onSize} loading={loading} donVi={DON_VI[tab]} ariaLabel={`Phân trang ${DON_VI[tab]}`} />
      )}
    </>
  );
}

/** Tab Điều chuyển của trang một kho (04/11/2026): cùng khuôn tab Lịch sử chuyển kho của ngăn (ô tìm,
 *  kỳ, Lọc, Cột, kéo rộng, ghim, cột ĐVT đổi được) thêm cột Mặt hàng. ĐVT mỗi dòng theo đơn vị xem
 *  được của chính dòng đó (máy chủ gửi `don_vi_xem`), mặc định đơn vị gốc. Tự nạp + giữ bộ lọc. */
export function TabDieuChuyenKho({ token, khoId, canViewCost }: { token: string; khoId: number; canViewCost: boolean }) {
  useNapTenDonVi();
  const luoi = useCauHinhLuoi("kho-dieu-chuyen");
  const dvd = useDvDong();
  const [loc, setLoc] = useState<LocTab>(() => locTabTrong("chuyen"));
  const [qGui, setQGui] = useState("");
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(25);
  const [trang, setTrang] = useState<ChuyenKhoPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [loi, setLoi] = useState<string | null>(null);
  const [lan, setLan] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setQGui(loc.q), 300);
    return () => clearTimeout(t);
  }, [loc.q]);
  const khoaNap = JSON.stringify(thamSoTab(loc, qGui));
  useEffect(() => {
    let huy = false;
    setLoading(true);
    api.kho.phieu
      .chuyenKho(token, khoId, { ...(JSON.parse(khoaNap) as LocNganMatHang), page, size })
      .then((r) => { if (!huy) { setTrang(r); setLoi(null); } })
      .catch((e) => { if (!huy) setLoi(e instanceof ApiError ? e.message : "Không tải được lịch sử chuyển kho."); })
      .finally(() => { if (!huy) setLoading(false); });
    return () => { huy = true; };
  }, [token, khoId, khoaNap, page, size, lan]);

  const rows = trang?.items ?? [];
  const theoKhoa = new Map(rows.map((r) => [r.key, r]));
  const dvOf = (k: string): [DvNgan, string] => {
    const r = theoKhoa.get(k);
    return [{ ds: r?.don_vi_xem ?? [], ma: null }, r?.don_vi_xem?.[0]?.ten ?? tenDonVi(r?.dvt) ?? r?.dvt ?? ""];
  };
  const dvCua = (k: string) => dvd.dvCua(k, ...dvOf(k));
  const cotChuyen = cotTheoTab("chuyen", {
    sl: (k, n, dau = "") => (n == null ? tru : `${dau}${fmtQty(n / dvCua(k).heSo)}`),
    gia: (k, n) => (n == null ? "" : money(n * dvCua(k).heSo)),
    dvCua,
    oDv: (k) => dvd.oDv(k, ...dvOf(k)),
    laGiay: false, canViewCost, canCreate: false, onBoSungKho: () => {}, onOpenVoucher: () => {},
    onLuuGhiChu: async () => {}, suaDuoc: false, lo: [],
  }) as Cot<ChuyenKhoRow>[];
  const cotHang: Cot<ChuyenKhoRow> = {
    key: "hang", label: "Mặt hàng", w: 250,
    o: (r) => (
      <span title={r.hang_ma ?? undefined}>
        {r.hang_ten ?? r.hang_ma ?? "vật tư"}
        {r.kho && <span className="lds-mu3"> {r.kho}</span>}
      </span>
    ),
  };
  const cot = [cotChuyen[0], cotHang, ...cotChuyen.slice(1)];
  const doiLoc = (l: LocTab) => { setLoc(l); setPage(1); };
  const xoaLoc = () => doiLoc(locTabTrong("chuyen"));
  const coLoc = !!loc.q || loc.ky.loai !== "tat_ca" || Object.values(loc.loc).some((v) => v?.length);

  return (
    <>
      <section className="lds-loc">
        <div className="lds-loc__thanh tl-thanh" role="search">
          <OTim value={loc.q} onChange={(q) => doiLoc({ ...loc, q })} placeholder="Tìm mã, tên vật tư"
            ariaLabel="Tìm vật tư đã chuyển" />
          <ThanhLoc
            ky={loc.ky}
            moc={MOC.chuyen}
            onKy={(ky) => doiLoc({ ...loc, ky })}
            dieuKien={dieuKien("chuyen", trang?.chon ?? {})}
            loc={loc.loc}
            onLoc={(l) => doiLoc({ ...loc, loc: l })}
            onXoaHet={xoaLoc}
          />
          <ChonCot cot={cot} {...luoi.chonCot} />
        </div>
      </section>
      <div className="lds-sheet">
        {loi ? (
          <div className="lds-trong">
            <span className="lds-do">{loi}</span>{" "}
            <button type="button" className="lds-lk" onClick={() => setLan((n) => n + 1)}>Thử lại</button>
          </div>
        ) : loading && !trang ? (
          <div className="lds-trong">Đang tải…</div>
        ) : rows.length === 0 ? (
          <Luoi cot={cot} luoi={luoi} rows={[]} khoa={(r) => r.key} trong={<>
            {coLoc ? "Không có lần chuyển nào khớp điều kiện đang lọc." : "Kho này chưa chuyển hay nhận hàng từ kho khác."}{" "}
            {coLoc && <button type="button" className="lds-lk" onClick={xoaLoc}>Xoá bộ lọc</button>}
          </>} />
        ) : (
          <Luoi cot={cot} luoi={luoi} rows={rows} khoa={(r) => r.key} />
        )}
        {!loi && trang && trang.total > 0 && (
          <PhanTrangDayDu trang={page} size={size} tong={trang.total} soDong={rows.length} onTrang={setPage}
            onSize={(n) => { setSize(n); setPage(1); }} loading={loading} donVi="lần chuyển"
            ariaLabel="Phân trang lịch sử chuyển kho" />
        )}
      </div>
    </>
  );
}

interface BoiCanh {
  /** Số theo đơn vị của dòng `k` (chỉ số, đơn vị nằm ở cột ĐVT). */
  sl: (k: string, n: number | null | undefined, dau?: string) => ReactNode;
  gia: (k: string, n: number | null | undefined) => string;
  dvCua: (k: string) => DvDong;
  /** Ô ĐVT của dòng: ô chọn khi có đơn vị quy được, không thì tên đơn vị gốc. */
  oDv: (k: string) => ReactNode;
  laGiay: boolean;
  canViewCost: boolean;
  canCreate: boolean;
  onBoSungKho: (lot: StockLot) => void;
  onOpenVoucher: (voucherId: number) => void;
  onLuuGhiChu: (id: number, ghiChu: string) => Promise<void>;
  suaDuoc: boolean;
  lo: StockLot[];
}

function phieu(id: number | null | undefined, ma: string | null | undefined, mo: (id: number) => void, trong = "Đầu kỳ") {
  return id != null ? <CodeLink code={ma ?? "—"} onOpen={() => mo(id)} /> : trong;
}

function cotTheoTab(tab: TabBang, b: BoiCanh): Cot<never>[] {
  if (tab === "lo_ton") {
    const coNguon = b.lo.some((l) => l.order_ma || l.lsx_ma);
    const coGiaBan = b.canViewCost && b.lo.some((l) => l.don_gia_ban != null);
    const coKho = b.laGiay || b.lo.some((l) => l.kho_rong > 0);
    const c: Cot<StockLot>[] = [
      { key: "phieu", label: "Phiếu", w: 120, o: (l) => phieu(l.voucher_id, l.voucher_ma ?? l.ma_lo, b.onOpenVoucher) },
      { key: "ngay", label: "Ngày nhập", w: 100, o: (l) => fmtDateISO(l.ngay_nhap) },
      ...(coNguon ? [{
        key: "nguon", label: "Đơn và khách", w: 170,
        o: (l: StockLot) => (!l.order_ma && !l.lsx_ma ? tru : (
          <>{l.order_ma}{l.lsx_ma && <span className="lds-tag">{l.lsx_ma}</span>}{l.khach_hang && <span className="lds-u">{l.khach_hang}</span>}</>
        )),
      }] : []),
      { key: "dvt", label: "ĐVT", w: 80, o: (l) => b.oDv(`l${l.id}`) },
      { key: "con_lai", label: "Còn lại", w: 110, n: true, o: (l) => b.sl(`l${l.id}`, l.sl_con_lai) },
      ...(coKho ? [{
        key: "kho", label: "Dạng / khổ", w: 150,
        o: (l: StockLot) => (
          <>
            {b.laGiay || l.kho_rong ? nhanKho(l.kho_rong, l.kho_dai) : tru}
            {b.laGiay && !l.kho_rong && b.canCreate && (
              <button type="button" className="kho-bsdk__nut" onClick={() => b.onBoSungKho(l)}>Bổ sung khổ</button>
            )}
          </>
        ),
      }] : []),
      { key: "vi_tri", label: "Vị trí", w: 140, o: (l) => l.vi_tri || tru },
      { key: "hsd", label: "HSD", w: 100, o: (l) => hsd(l.hsd), lop: (l) => lopHsd(l.hsd) },
      ...(b.canViewCost ? [{
        key: "don_gia", label: "Đơn giá", w: 120, n: true,
        o: (l: StockLot) => (loChuaGiaGoc(l) ? <NhanChuaGiaGoc /> : b.gia(`l${l.id}`, l.don_gia_nhap ?? 0)),
      }] : []),
      ...(coGiaBan ? [{ key: "gia_ban", label: "Giá bán", w: 110, n: true, o: (l: StockLot) => (l.don_gia_ban != null ? money(l.don_gia_ban) : tru) }] : []),
      ...(b.canViewCost ? [{
        key: "gia_tri", label: "Giá trị", w: 130, n: true,
        o: (l: StockLot) => (loChuaGiaGoc(l) ? tru : money(Math.round(l.sl_con_lai * (l.don_gia_nhap ?? 0)))),
      }] : []),
    ];
    return c as Cot<never>[];
  }
  if (tab === "nhap_xuat") {
    const c: Cot<NhapXuatRow>[] = [
      { key: "luc", label: "Ngày giờ", w: 150, o: (r) => fmtDateTime(r.luc) },
      {
        key: "viec", label: "Việc", w: 90,
        o: (r) => <span className={`lss-chip ${r.viec === "nhap" ? "lss-chip--xanh" : "lss-chip--cam"}`}>{r.viec === "nhap" ? "Nhập" : "Xuất"}</span>,
      },
      { key: "phieu", label: "Phiếu", w: 120, o: (r) => phieu(r.voucher_id, r.voucher_ma, b.onOpenVoucher) },
      { key: "dvt", label: "ĐVT", w: 80, o: (r) => b.oDv(r.key) },
      {
        key: "so_luong", label: "Số lượng", w: 110, n: true,
        o: (r) => b.sl(r.key, r.so_luong, r.viec === "nhap" ? "+" : "−"), lop: (r) => (r.viec === "nhap" ? "lss-tang" : "lss-giam"),
      },
      { key: "ton_sau", label: "Tồn sau", w: 110, n: true, o: (r) => b.sl(r.key, r.ton_sau) },
      { key: "vi_tri", label: "Vị trí", w: 120, o: (r) => r.vi_tri || tru },
      { key: "hsd", label: "HSD", w: 100, o: (r) => hsd(r.hsd), lop: (r) => lopHsd(r.hsd) },
      ...(b.canViewCost ? [
        {
          key: "don_gia", label: "Đơn giá", w: 120, n: true,
          o: (r: NhapXuatRow) => (r.chua_gia_goc ? <NhanChuaGiaGoc /> : b.gia(r.key, r.don_gia)),
        },
        { key: "gia_tri", label: "Giá trị", w: 130, n: true, o: (r: NhapXuatRow) => (r.gia_tri != null ? money(r.gia_tri) : tru) },
      ] : []),
      { key: "nguoi", label: "Người làm", w: 140, o: (r) => r.nguoi || tru },
    ];
    return c as Cot<never>[];
  }
  if (tab === "chuyen") {
    const c: Cot<ChuyenKhoRow>[] = [
      { key: "luc", label: "Ngày giờ", w: 150, o: (r) => fmtDateTime(r.luc) },
      { key: "kho_tu", label: "Từ kho", w: 130, o: (r) => r.kho_tu },
      { key: "lay_o", label: "Lấy ở", w: 90, o: (r) => r.lay_o || tru },
      { key: "kho_den", label: "Sang kho", w: 130, o: (r) => r.kho_den },
      { key: "cat_o", label: "Cất ở", w: 90, o: (r) => r.cat_o || tru },
      { key: "dvt", label: "ĐVT", w: 80, o: (r) => b.oDv(r.key) },
      { key: "so_luong", label: "Số lượng", w: 110, n: true, o: (r) => b.sl(r.key, r.so_luong) },
      ...(b.canViewCost ? [{ key: "gia_tri", label: "Giá trị", w: 130, n: true, o: (r: ChuyenKhoRow) => (r.gia_tri != null ? money(r.gia_tri) : "") }] : []),
      { key: "nguoi", label: "Người chuyển", w: 140, o: (r) => r.nguoi || tru },
    ];
    return c as Cot<never>[];
  }
  // Lịch sử sửa: ô gộp theo lần sửa (Ngày giờ, Người sửa, Việc, Ghi chú) — vẽ ở `LuoiSua`.
  const doi = (d: LichSuSuaDoi | null, ve: "truoc" | "sau", k: string) => (d ? hienDoi(d, ve, b.dvCua(k)) : "");
  const c: Cot<DongSua>[] = [
    { key: "luc", label: "Ngày giờ", w: 150, o: ({ r }) => fmtDateTime(r.luc), lop: () => "lss-gio" },
    { key: "nguoi", label: "Người sửa", w: 120, o: ({ r }) => r.nguoi || tru },
    { key: "viec", label: "Việc", w: 130, o: ({ r }) => <span className={`lss-chip ${LOP_VIEC[r.viec] ?? ""}`}>{r.viec}</span> },
    { key: "thong_tin", label: "Thông tin", w: 130, o: ({ d }) => d?.thong_tin ?? tru },
    { key: "dvt", label: "ĐVT", w: 80, o: ({ d, k }) => (d && coDv(d) ? b.oDv(k) : "") },
    { key: "truoc", label: "Trước", w: 120, n: true, o: ({ d, k }) => doi(d, "truoc", k), lop: () => "lss-truoc" },
    { key: "sau", label: "Sau", w: 120, n: true, o: ({ d, k }) => doi(d, "sau", k) },
    { key: "chenh", label: "Chênh", w: 110, n: true, o: ({ d, k }) => (d ? chenhQuy(d, b.dvCua(k)) : null) },
    {
      key: "ghi_chu", label: "Ghi chú", w: 220,
      o: ({ r }) => <OGhiChu r={r} suaDuoc={b.suaDuoc} onLuu={b.onLuuGhiChu} />, lop: () => "lss-ghi",
    },
  ];
  return c as Cot<never>[];
}

/** Thông tin đổi theo số lượng của dòng tồn (quy theo ĐVT) và theo giá (đ/đơn vị). */
const LA_SL = new Set(["Tồn", "Tối thiểu", "Tối đa"]);
const laGia = (d: LichSuSuaDoi) => d.thong_tin.startsWith("Giá gốc");

/** Dòng có cột ĐVT: số lượng của dòng tồn hoặc giá theo đơn vị, có số ở ít nhất một vế. */
const coDv = (d: LichSuSuaDoi) => (LA_SL.has(d.thong_tin) || laGia(d)) && (d.truoc_so != null || d.sau_so != null);

/** Vế trước/sau: dòng có ĐVT chỉ in số đã quy (vế không có số, vd "chưa đặt", giữ chữ). */
function hienDoi(d: LichSuSuaDoi, ve: "truoc" | "sau", dv: DvDong): string {
  const so = ve === "truoc" ? d.truoc_so : d.sau_so;
  if (so == null || !coDv(d)) return d[ve];
  return LA_SL.has(d.thong_tin) ? fmtQty(so / dv.heSo) : money(so * dv.heSo);
}

function chenhQuy(d: LichSuSuaDoi, dv: DvDong): ReactNode {
  if (!coDv(d)) return <Chenh v={d.chenh} dv={d.don_vi} />;
  if (d.chenh == null) return null;
  return LA_SL.has(d.thong_tin) ? <Chenh v={d.chenh / dv.heSo} dv="" /> : <Chenh v={d.chenh * dv.heSo} dv="" />;
}

interface DongSua { r: LichSuSuaRow; d: LichSuSuaDoi | null; k: string }
/** Cột gộp ô theo lần sửa: một lần sửa nhiều thông tin đổi thì các ô này chỉ vẽ ở dòng đầu. */
const GOP = new Set(["luc", "nguoi", "viec", "ghi_chu"]);

function LuoiSua({ rows, cot, luoi }: { rows: LichSuSuaRow[]; cot: Cot<DongSua>[]; luoi: CauHinhLuoi }) {
  const hien = luoi.rongHien(luoi.xep(cot).filter((c) => !luoi.an.has(c.key)));
  return (
    <CuonLuoi ghim={luoi.soGhim(hien)}>
      <table className="lds-g lss" style={{ minWidth: rongLuoi(hien) }}>
        <colgroup>{hien.map((c) => <col key={c.key} style={c.w ? { width: c.w } : undefined} />)}</colgroup>
        <thead>
          <tr>{hien.map((c) => <th key={c.key} className={c.n ? "n" : undefined}>{c.label}{luoi.keo(c.key)}</th>)}</tr>
        </thead>
        <tbody>
          {rows.flatMap((r) => {
            const dong = r.dong.length ? r.dong : [null];
            const n = dong.length;
            return dong.map((d, i) => (
              <tr key={`${r.id}-${i}`} className={i === n - 1 ? "lss-cuoi" : undefined}>
                {hien.map((c) => {
                  if (GOP.has(c.key) && i > 0) return null;
                  const dong = { r, d, k: `s${r.id}-${i}` };
                  const lop = [c.n ? "n" : "", c.lop?.(dong) ?? ""].join(" ").trim() || undefined;
                  return (
                    <td key={c.key} rowSpan={GOP.has(c.key) ? n : undefined} className={lop}>{c.o(dong)}</td>
                  );
                })}
              </tr>
            ));
          })}
        </tbody>
      </table>
    </CuonLuoi>
  );
}
