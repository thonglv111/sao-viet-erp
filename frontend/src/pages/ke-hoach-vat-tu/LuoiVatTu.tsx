// LƯỚI KẾ HOẠCH VẬT TƯ — spec `docs/spec-ke-hoach-vat-tu-mot-o-mot-phieu.md` §5, mockup
// `docs/mockups/ke-hoach-vat-tu-mot-o-mot-phieu.html` (07/10/2026).
//
// Mỗi dòng là MỘT Ô = một lệnh (hoặc bài ghép) với một mặt hàng; ô có tối đa một phiếu mua còn sống.
// "Theo lệnh" và "Theo mặt hàng" chỉ là hai cách nhóm cùng các dòng. Lọc, đếm, nhóm, cắt trang đều
// ở máy chủ (`/api/ke-hoach-vat-tu/luoi`); hai ngăn đọc `/luoi/lenh` và `/luoi/hang` từ cùng bản số.
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Download, Link2, ShoppingCart } from "lucide-react";

import {
  ApiError,
  api,
  type BuocPhieu,
  type CungKhoKhacDonVi,
  type DeNghiMuaXemTruoc,
  type LuoiDong,
  type LuoiHang,
  type LuoiLenh,
  type LuoiOut,
  type LuoiPhieu,
  type TinhTrangO,
} from "../../api/client";
import { useCan } from "../../auth/permissions";
import { useAuth } from "../../auth/useAuth";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { EmptyRow } from "../../components/EmptyState";
import { ChipTT, CuonLuoi, LocNhanhTrangThai, OTim, type MauTT, type MucLocNhanh } from "../../components/LuoiDs";
import { PhanTrangDayDu } from "../../components/PhanTrangDayDu";
import { nhanKho, tenGoc } from "../../lib/khoGiay";
import { NganPhai } from "../ke-toan/shared/NganPhai";
import {
  LOC_KHVT_HANG_TRONG,
  MAN_KHVT,
  dieuKienKhvtHang,
  locKhvtHangLenUrl,
  locKhvtHangTuUrl,
} from "../loc-san-xuat/dieu-kien-ke-hoach-vat-tu";
import { ThanhLoc } from "../thanh-loc/ThanhLoc";
import { useLocMan } from "../thanh-loc/useLocMan";
import { cauMuaKhacQuyCach } from "./muaKhacQuyCach";
import "../ke-toan/ke-toan.css";
import "./luoi-vat-tu.css";

type Xem = "lenh" | "hang";

/** Tình trạng → nhãn + màu. Mỗi tình trạng một sắc riêng (bộ `--tt-*`). */
export const TINH_TRANG: Record<TinhTrangO, { nhan: string; mau: MauTT }> = {
  can_mua: { nhan: "Cần mua", mau: "do" },
  nen_nha: { nhan: "Nên nhả hàng", mau: "cyan" },
  dang_mua: { nhan: "Đang mua", mau: "vang" },
  chua_giu: { nhan: "Chưa giữ", mau: "xanh" },
  cho_ve: { nhan: "Chờ hàng về", mau: "cham" },
  co_kho: { nhan: "Có trong kho", mau: "la" },
  // Kho đã ghi sổ phiếu xuất đủ cho lệnh — hàng đã xuống xưởng, không phải giao cho khách.
  da_xuat: { nhan: "Đã cấp cho xưởng", mau: "xam" },
  chua_tinh: { nhan: "Chưa tính được", mau: "cam" },
};
const THU_TU_LOC: TinhTrangO[] = ["can_mua", "nen_nha", "dang_mua", "chua_giu", "cho_ve", "co_kho", "da_xuat", "chua_tinh"];

export const NHAN_BUOC: Record<BuocPhieu, string> = {
  moi_de_nghi: "Mới đề nghị",
  don_bi_tra: "Đơn bị trả, chờ lập lại",
  dang_lap_don: "Đang lập đơn",
  cho_duyet: "Chờ duyệt",
  da_dat_hang: "Đã đặt hàng",
  da_nhap_kho: "Đã nhập kho",
};
/** Vị trí trên vạch 5 nấc — đơn bị trả đứng ở nấc lập đơn. */
const NAC: Record<BuocPhieu, number> = {
  moi_de_nghi: 0, don_bi_tra: 1, dang_lap_don: 1, cho_duyet: 2, da_dat_hang: 3, da_nhap_kho: 4,
};

const so = (v: number | null | undefined) =>
  v == null ? "—" : Number(v).toLocaleString("vi-VN", { maximumFractionDigits: 2 });

function ngayNgan(v: string | null | undefined, nam = true): string {
  if (!v) return "";
  const [y, m, d] = v.slice(0, 10).split("-");
  return nam ? `${d}/${m}/${y}` : `${d}/${m}`;
}

function ngayGio(v: string | null): string {
  if (!v) return "";
  const t = new Date(v);
  if (Number.isNaN(t.getTime())) return "";
  return `${t.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" })} ${t.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}`;
}

export function Chip({ t }: { t: TinhTrangO }) {
  const c = TINH_TRANG[t];
  return <ChipTT mau={c.mau}>{c.nhan}</ChipTT>;
}

export function Buoc({ b }: { b: BuocPhieu }) {
  const n = NAC[b];
  return (
    <span className="lvt-buoc" title={NHAN_BUOC[b]}>
      <span className="lvt-nac" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((i) => (
          <b key={i} className={i < n || b === "da_nhap_kho" ? "ok" : i === n ? "now" : undefined} />
        ))}
      </span>
      {/* Trong ô lưới chỉ đủ chỗ chữ ngắn; câu đủ nằm ở tooltip. */}
      {b === "don_bi_tra" ? "Đơn bị trả" : NHAN_BUOC[b]}
    </span>
  );
}

/** Chỉ hàng còn chờ mới có ngày; hàng đã trong kho / đã cấp thì để "—" — cột Tình trạng đã nói. */
function NgayCoHang({ d }: { d: LuoiDong }) {
  const n = d.ngay_co_hang;
  if (n.loai === "ngay_ve") return <>{ngayNgan(n.ngay)}</>;
  if (n.loai === "hen") return <span className="lvt-mu">hẹn {ngayNgan(n.ngay, false)}</span>;
  return <span className="lvt-mu3">—</span>;
}

function TenHang({ d }: { d: { hang_ten: string; hang_loai: string; kho_rong: number; kho_dai: number } }) {
  return (
    <>
      {d.hang_ten}
      {(d.hang_loai === "giay" || d.hang_loai === "vat_tu") && d.kho_rong > 0 && (
        <span className="lvt-tag">{nhanKho(d.kho_rong, d.kho_dai)}</span>
      )}
    </>
  );
}

/** Tồn + đang về của CÙNG mã + CÙNG khổ nhưng khác đơn vị gốc (nhóm tính tờ, kho còn giấy cùng khổ
 *  nhập theo kg). Chỉ bày cạnh số chính bằng chữ nhỏ — tờ và kg không quy đổi nên máy KHÔNG trừ
 *  vào thiếu; người lập kế hoạch nhìn rồi tự quyết (10/10/2026). */
function CungKhoKhac({ ds }: { ds: CungKhoKhacDonVi[] | undefined }) {
  const co = (ds ?? []).filter((x) => x.ton > 0 || x.dang_ve > 0);
  if (!co.length) return null;
  return (
    <span className="lvt-khac" title="Cùng mã (giấy thì cùng khổ) nhưng đếm theo đơn vị khác, không trừ vào số thiếu">
      <span>Khác đơn vị:</span>
      {co.map((x) => (
        <span key={x.don_vi_goc} className="lvt-khac__so">
          {x.ton > 0 && <span>{so(x.ton)} {x.don_vi_goc_ten || x.don_vi_goc} tồn</span>}
          {x.dang_ve > 0 && <span>{so(x.dang_ve)} {x.don_vi_goc_ten || x.don_vi_goc} đang về</span>}
        </span>
      ))}
    </span>
  );
}

function GhiChu({ ds }: { ds: string[] }) {
  if (!ds.length) return null;
  return (
    <span className="lvt-ghichu">
      {ds.map((g) => (
        <span key={g} className="lvt-warn">
          <AlertTriangle size={12} aria-hidden="true" />
          {g}
        </span>
      ))}
    </span>
  );
}

const TIEU_DE_DA_CO = "Đã cấp cho xưởng, cộng phần đang giữ trong kho và giữ trên hàng đang về";

type MoPhieu = (p: { ma: string; loai: "pmh" | "ycmh"; yc_ma: string }) => void;

function OPhieu({ d, moPhieu }: { d: LuoiDong; moPhieu: MoPhieu }) {
  if (d.phieu) {
    return (
      <button type="button" className="lvt-lk" onClick={() => moPhieu(d.phieu!)}>
        {d.phieu.ma}
      </button>
    );
  }
  if (d.du_tu.length) {
    return (
      <span className="lvt-dutu">
        <span className="lvt-mu">dư từ</span>
        {d.du_tu.map((m) => (
          <button key={m} type="button" className="lvt-lk" onClick={() => moPhieu({ ma: m, loai: "pmh", yc_ma: "" })}>
            {m}
          </button>
        ))}
      </span>
    );
  }
  return <span className="lvt-mu3">—</span>;
}

/** Dòng mà nhu cầu ra đơn vị mã CHƯA khai ở danh mục (spec 2026-10-10 mặt hàng nhiều ĐVT §3): thay ô
 *  lập mua bằng câu nói rõ phải khai đơn vị nào — tick vào cũng chỉ ăn lỗi ở máy chủ. */
function ChuaKhaiDonVi({ d }: { d: LuoiDong }) {
  const dv = tenGoc(d.don_vi_goc || d.dvt) || d.dvt;
  const cau = `Chưa khai đơn vị «${dv}» ở danh mục`;
  return (
    <span className="lvt-warn" title={`${cau} — khai thêm đơn vị này ở danh mục mặt hàng rồi mới lập mua được`}>
      <AlertTriangle size={12} aria-hidden="true" />
      {cau}
    </span>
  );
}

// ============================================================================
export function LuoiVatTu({
  eventTick,
  focusLsxMa,
  canDeNghiMua,
  onMoFormMua,
  onOpenLsx,
  navigate,
  onSoViec,
}: {
  eventTick?: number;
  focusLsxMa?: string | null;
  canDeNghiMua: boolean;
  onMoFormMua?: (nhap: DeNghiMuaXemTruoc) => void;
  onOpenLsx?: (id: number) => void;
  navigate?: (id: string, params?: Record<string, unknown>) => void;
  onSoViec?: (n: number) => void;
}) {
  const { token } = useAuth();
  const can = useCan();
  const coGiu = can("ke_hoach_vat_tu", "update");
  const coHuy = can("yeu_cau_mua_hang", "update");
  const [xem, setXem] = useState<Xem>("lenh");
  const [q, setQ] = useState(focusLsxMa ?? "");
  const [tinh, setTinh] = useState<TinhTrangO | "co_ghi_chu" | null>(null);
  const [loc, setLoc] = useLocMan(MAN_KHVT, LOC_KHVT_HANG_TRONG, locKhvtHangTuUrl, locKhvtHangLenUrl);
  const [trang, setTrang] = useState(1);
  const [size, setSize] = useState(25);
  const [data, setData] = useState<LuoiOut | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [dong, setDong] = useState<Set<string>>(new Set());
  const [chon, setChon] = useState<Map<string, LuoiDong>>(new Map());
  const [ban, setBan] = useState<string | null>(null);
  const [ngLenh, setNgLenh] = useState<{ lsx_id: number | null; bai_ghep_id: number | null; hoiNha?: boolean } | null>(null);
  const [ngHang, setNgHang] = useState<{ hang_loai: "giay" | "vat_tu"; hang_id: number; kho_rong: number; kho_dai: number; don_vi_goc: string } | null>(null);
  const [nap, setNap] = useState(0);

  useEffect(() => {
    if (focusLsxMa) {
      setQ(focusLsxMa);
      setXem("lenh");
    }
  }, [focusLsxMa]);

  // Đổi điều kiện ⇒ về trang 1.
  useEffect(() => setTrang(1), [xem, q, tinh, loc.loai, size]);

  const load = useCallback(() => {
    if (!token) return;
    setLoading(true);
    api.keHoachVatTu
      .luoi(token, {
        xem,
        q: q.trim() || undefined,
        tinh_trang: tinh ?? undefined,
        hang_loai: loc.loai,
        page: trang,
        size,
      })
      .then((r) => {
        setData(r);
        setErr(null);
        // Badge thanh bên = việc phải lo của CẢ xưởng — chỉ báo khi chưa tìm/lọc loại hàng.
        if (!q.trim() && !loc.loai) onSoViec?.((r.dem.can_mua ?? 0) + (r.dem.chua_tinh ?? 0));
      })
      .catch((e: unknown) => setErr(e instanceof ApiError ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [token, xem, q, tinh, loc.loai, trang, size, onSoViec]);

  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, eventTick, nap, q]);

  // Dòng đã tick mà nạp lại không còn "Cần mua" (người khác vừa đề nghị) thì rụng khỏi tập chọn.
  useEffect(() => {
    if (!data) return;
    const con = new Map<string, LuoiDong>();
    data.items.forEach((n) => n.dong.forEach((d) => con.set(d.khoa, d)));
    setChon((cu) => {
      const moi = new Map<string, LuoiDong>();
      cu.forEach((v, k) => {
        const d = con.get(k);
        if (!d || d.tinh_trang === "can_mua") moi.set(k, d ?? v);
      });
      return moi.size === cu.size ? cu : moi;
    });
  }, [data]);

  const moPhieu: MoPhieu = useCallback(
    (p) => {
      if (!navigate) return;
      if (p.loai === "pmh") navigate("mua-hang", { focusRequestCode: p.ma });
      else navigate("yeu-cau-mua-hang", { focusRequestCode: p.yc_ma || p.ma });
    },
    [navigate],
  );

  function bat(k: string) {
    setChon((cu) => {
      const m = new Map(cu);
      if (m.has(k)) m.delete(k);
      else {
        const d = data?.items.flatMap((n) => n.dong).find((x) => x.khoa === k);
        if (d) m.set(k, d);
      }
      return m;
    });
  }

  async function deNghiMua() {
    if (!token || chon.size === 0) return;
    setBan("mua");
    setErr(null);
    try {
      const nhap = await api.keHoachVatTu.xemTruocDeNghiMua(token, [...chon.values()].flatMap((d) => d.khoa_mua));
      onMoFormMua?.(nhap);
      setChon(new Map());
    } catch (e: unknown) {
      setErr(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBan(null);
    }
  }

  async function giuHang(l: { lsx_id: number | null; bai_ghep_id: number | null; ma: string }) {
    if (!token) return;
    setBan(`giu:${l.ma}`);
    setErr(null);
    try {
      await api.keHoachVatTu.giuCho(token, true, l);
      setNap((n) => n + 1);
    } catch (e: unknown) {
      setErr(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBan(null);
    }
  }

  const xuatExcel = async () => {
    if (!token) return;
    setBan("xuat");
    try {
      const url = await api.keHoachVatTu.xuatLuoiBlobUrl(token, {
        xem, q: q.trim() || undefined, tinh_trang: tinh ?? undefined, hang_loai: loc.loai,
      });
      const a = document.createElement("a");
      a.href = url;
      a.download = "ke-hoach-vat-tu.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (e: unknown) {
      setErr(e instanceof ApiError ? e.message : "Không xuất được Excel.");
    } finally {
      setBan(null);
    }
  };

  const dem = data?.dem ?? {};
  const items = data?.items ?? [];
  const chonDs = [...chon.values()];
  const soLenhChon = new Set(chonDs.map((d) => d.chu)).size;
  const dieuKien = useMemo(() => dieuKienKhvtHang(), []);
  // Số bên cạnh từng mục do MÁY CHỦ đếm (`dem`, trên tập đã tìm + lọc loại hàng, trước khi chọn
  // tình trạng) — đếm theo DÒNG (ô lệnh × mặt hàng), không phải theo nhóm đang cắt trang.
  const mucTinhTrang: MucLocNhanh[] = [
    { key: "", label: "Tất cả", count: dem.tat_ca },
    // Hai tình trạng hiếm chỉ hiện khi có dòng (hoặc đang chọn).
    ...THU_TU_LOC.filter((t) => (t !== "chua_tinh" && t !== "nen_nha") || (dem[t] ?? 0) > 0 || tinh === t).map((t) => ({
      key: t, label: TINH_TRANG[t].nhan, mau: TINH_TRANG[t].mau, count: dem[t],
    })),
    { key: "co_ghi_chu", label: "Có ghi chú", mau: "tim" as MauTT, count: dem.co_ghi_chu },
  ];

  const doiNhom = (k: string) =>
    setDong((cu) => {
      const s = new Set(cu);
      if (s.has(k)) s.delete(k);
      else s.add(k);
      return s;
    });

  return (
    <div className="lvt lds">
      <header className="lds-dau">
        <h1 className="lds-dau__ten">Kế hoạch vật tư</h1>
        <div className="lds-dau__nut">
          <button type="button" className="lds-btn" onClick={() => void xuatExcel()} disabled={ban === "xuat"}>
            <Download size={14} aria-hidden="true" />
            {ban === "xuat" ? "Đang xuất…" : "Xuất Excel"}
          </button>
        </div>
      </header>

      {err && (
        <div className="banner banner--error lvt-loi" role="alert">
          <span>{err}</span>
          <button type="button" className="lvt-btn lvt-btn--xs" onClick={() => setErr(null)}>Đóng</button>
        </div>
      )}

      <section className="lds-loc">
        <LocNhanhTrangThai muc={mucTinhTrang} dang={tinh ?? ""} onChon={(k) => setTinh(k === "" ? null : (k as TinhTrangO | "co_ghi_chu"))}
          ariaLabel="Lọc theo tình trạng" />
        <div className="lds-loc__thanh tl-thanh" role="search">
          <span className="lvt-lbl">Xem theo</span>
          <div className="lvt-seg" role="group" aria-label="Xem theo">
            <button type="button" className={xem === "lenh" ? "on" : undefined} aria-pressed={xem === "lenh"} onClick={() => setXem("lenh")}>
              Lệnh
            </button>
            <button type="button" className={xem === "hang" ? "on" : undefined} aria-pressed={xem === "hang"} onClick={() => setXem("hang")}>
              Mặt hàng
            </button>
          </div>
          <OTim value={q} onChange={setQ} placeholder="Tìm lệnh, mặt hàng, mã phiếu" ariaLabel="Tìm lệnh, mặt hàng, mã phiếu" />
          <ThanhLoc dieuKien={dieuKien} loc={loc} onLoc={setLoc} />
        </div>
      </section>

      <div className="lds-sheet">
        <CuonLuoi ghim={2}>
          <table className="lds-g lvt-g">
            {/* Tổng cột cố định ~1070px + Ghi chú co giãn, vừa lưới rộng 1180px không phải cuộn ngang. Không có
                cột ĐVT riêng: đơn vị đi sau số Cần (dòng mặt hàng ở cách xem theo lệnh, dòng nhóm ở cách xem theo
                mặt hàng), nói một lần. */}
            <colgroup>
              <col style={{ width: 36 }} /><col style={{ width: 248 }} />
              <col style={{ width: 96 }} /><col style={{ width: 64 }} /><col style={{ width: 80 }} />
              <col style={{ width: 128 }} /><col style={{ width: 160 }} /><col style={{ width: 104 }} />
              <col style={{ width: 156 }} /><col />
            </colgroup>
            <thead>
              <tr>
                <th aria-label="Chọn" />
                <th>{xem === "lenh" ? "Mặt hàng" : "Lệnh"}</th>
                <th className="n">Cần</th>
                <th className="n" title={TIEU_DE_DA_CO}>Đã có</th>
                <th className="n">Còn thiếu</th>
                <th>Phiếu mua</th>
                <th>Bước của phiếu</th>
                <th>Ngày có hàng</th>
                <th>Tình trạng</th>
                <th>Ghi chú</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && loading && <EmptyRow colSpan={10} trangThai="dang-tai" />}
              {items.length === 0 && !loading && (
                <tr>
                  <td colSpan={10} className="lds-trong">
                    {q || tinh || loc.loai ? "Không dòng nào khớp điều kiện." : "Chưa lệnh nào cần vật tư."}
                  </td>
                </tr>
              )}
              {items.map((n) => {
                const mo = !dong.has(n.khoa);
                return (
                  <NhomDong key={n.khoa} n={n} xem={xem} mo={mo} onDoi={() => doiNhom(n.khoa)}
                    chon={chon} onChon={bat} canMua={canDeNghiMua} coGiu={coGiu} ban={ban}
                    onGiu={giuHang} moPhieu={moPhieu}
                    onNha={(d) => setNgLenh({ lsx_id: d.lsx_id, bai_ghep_id: d.bai_ghep_id, hoiNha: true })}
                    onMoLenh={(d) => setNgLenh({ lsx_id: d.lsx_id, bai_ghep_id: d.bai_ghep_id })}
                    onMoHang={(d) => setNgHang({ hang_loai: d.hang_loai, hang_id: d.hang_id, kho_rong: d.kho_rong, kho_dai: d.kho_dai, don_vi_goc: d.don_vi_goc ?? "" })} />
                );
              })}
            </tbody>
          </table>
        </CuonLuoi>
        <PhanTrangDayDu trang={data?.page ?? trang} size={size} tong={data?.tong_nhom ?? null}
          soDong={items.length} onTrang={setTrang} onSize={setSize} loading={loading}
          donVi={xem === "lenh" ? "lệnh" : "mặt hàng"} />
      </div>

      {chon.size > 0 && (
        <div className="lvt-bulk" role="region" aria-label="Dòng đã chọn">
          <span>Đã chọn {chon.size} dòng</span>
          <span className="lvt-mu">
            {chon.size === 1
              ? `${chonDs[0].hang_ten} ${so(chonDs[0].so_de_nghi)} ${chonDs[0].dvt} cho ${chonDs[0].ma}`
              : `${soLenhChon} lệnh`}
          </span>
          <button type="button" className="lvt-btn lvt-btn--ghost" onClick={() => setChon(new Map())}>Bỏ chọn</button>
          <button type="button" className="lvt-btn lvt-btn--pri" onClick={() => void deNghiMua()} disabled={ban === "mua"}>
            <ShoppingCart size={14} aria-hidden="true" />
            {ban === "mua" ? "Đang mở…" : "Đề nghị mua"}
          </button>
        </div>
      )}

      {ngLenh && (
        <NganLenh chu={ngLenh} hoiNhaNgay={!!ngLenh.hoiNha} eventTick={(eventTick ?? 0) + nap} coGiu={coGiu} coHuy={coHuy}
          moPhieu={moPhieu} onOpenLsx={onOpenLsx} onDong={() => setNgLenh(null)}
          onDoi={() => setNap((x) => x + 1)} />
      )}
      {ngHang && (
        <NganHang h={ngHang} eventTick={(eventTick ?? 0) + nap} coHuy={coHuy} moPhieu={moPhieu}
          onMoLenh={(d) => {
            setNgHang(null);
            setNgLenh({ lsx_id: d.lsx_id, bai_ghep_id: d.bai_ghep_id });
          }}
          onDong={() => setNgHang(null)} onDoi={() => setNap((x) => x + 1)} />
      )}
    </div>
  );
}

// ============================================================================
function NhomDong({
  n, xem, mo, onDoi, chon, onChon, canMua, coGiu, ban, onGiu, onNha, moPhieu, onMoLenh, onMoHang,
}: {
  n: LuoiOut["items"][number];
  xem: Xem;
  mo: boolean;
  onDoi: () => void;
  chon: Map<string, LuoiDong>;
  onChon: (k: string) => void;
  canMua: boolean;
  coGiu: boolean;
  ban: string | null;
  onGiu: (l: { lsx_id: number | null; bai_ghep_id: number | null; ma: string }) => void;
  onNha: (l: { lsx_id: number | null; bai_ghep_id: number | null }) => void;
  moPhieu: MoPhieu;
  onMoLenh: (d: { lsx_id: number | null; bai_ghep_id: number | null }) => void;
  onMoHang: (d: LuoiDong) => void;
}) {
  const l = n.lenh;
  const conGiu = n.dong.some((d) => d.giu_kho + d.giu_ve > 0);
  const h = n.hang;
  const chev = mo ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />;
  return (
    <>
      {l && (
        <tr className="gr lds-nhom">
          <td colSpan={10} className="lead">
            <div className="gl">
              {/* Nhãn và nút Giữ / Nhả đứng yên bên trái khi cuộn ngang. */}
              <span className="lds-dinh-trai">
                <button type="button" className="lvt-chev" aria-expanded={mo} aria-label={mo ? "Thu nhóm" : "Mở nhóm"} onClick={onDoi}>{chev}</button>
                <button type="button" className="lvt-lk" onClick={() => onMoLenh(l)}>{l.ma}</button>
                {l.ten_sp && <span>{l.ten_sp}</span>}
                {l.khach_ten && <span className="lvt-mu">{l.khach_ten}</span>}
                {l.han_giao_khach && <span className="lvt-k">Giao {ngayNgan(l.han_giao_khach)}</span>}
                {l.is_rush && <span className="lvt-gap">Gấp</span>}
                {l.ngoai_pham_vi && <span className="lvt-k">Không còn trong kế hoạch</span>}
                {/* Nút nằm trong phần đứng yên, ngay cạnh tên lệnh — dạt mép phải thì lưới hẹp phải cuộn mới
                    thấy. Nhả mở ngăn lệnh với hộp hỏi lại (nhả không hoàn tác được). */}
                {coGiu && !l.bat && !l.ngoai_pham_vi && (
                  <button type="button" className="lvt-btn lvt-btn--xs" disabled={ban === `giu:${l.ma}`}
                    title="Giữ hàng có sẵn và hàng đặt cho lệnh này; hàng về sau tự giữ tiếp"
                    onClick={() => onGiu(l)}>
                    {ban === `giu:${l.ma}` ? "Đang giữ…" : "Giữ hàng"}
                  </button>
                )}
                {coGiu && conGiu && (
                  <button type="button" className="lvt-btn lvt-btn--xs" onClick={() => onNha(l)}
                    title="Nhả hàng đang giữ cho lệnh khác dùng">
                    Nhả hàng
                  </button>
                )}
              </span>
            </div>
          </td>
        </tr>
      )}
      {h && (
        <tr className="gr lds-nhom">
          <td colSpan={2} className="lead lvt-gr-ghim">
            <div className="gl">
              <span className="lds-dinh-trai">
                <button type="button" className="lvt-chev" aria-expanded={mo} aria-label={mo ? "Thu nhóm" : "Mở nhóm"} onClick={onDoi}>{chev}</button>
                <button type="button" className="lvt-lk" onClick={() => onMoHang(n.dong[0])}>{h.hang_ten}</button>
                {h.kho && <span className="lvt-tag">{h.kho}</span>}
              </span>
            </div>
          </td>
          <td className="n">{so(h.can)}<span className="lvt-u">{h.dvt}</span></td>
          <td className={`n${h.da_giu ? "" : " lvt-mu"}`}>{so(h.da_giu)}</td>
          <td className={`n${h.con_thieu > 0 ? " red" : " lvt-mu"}`}>{so(h.con_thieu)}</td>
          {/* Dòng nhóm không có phiếu/bước/tình trạng riêng: Tồn kho, Đang về và ghi chú đặt dư dùng
              chung dải ô còn lại, để ghi chú dài không bị cắt trong cột Ghi chú hẹp. */}
          <td colSpan={5} title={h.ghi_chu.join("\n") || undefined}>
            <span className="lvt-cap">
              <span className="lvt-mu">Tồn kho {so(h.ton)}</span>
              {h.dang_ve > 0 && <span className="lvt-mu">Đang về {so(h.dang_ve)}</span>}
              <CungKhoKhac ds={h.cung_kho_khac_don_vi} />
              <GhiChu ds={h.ghi_chu} />
            </span>
          </td>
        </tr>
      )}
      {mo &&
        n.dong.map((d) => {
          // Nhu cầu ra đơn vị mà mã chưa khai ở danh mục: không lập mua được dòng này (máy chủ cũng
          // chặn) — ô tick nhường chỗ cho câu nói rõ phải khai gì, ghi ở cột Phiếu.
          const chuaKhai = !!(d.don_vi_chua_khai || h?.don_vi_chua_khai);
          // Đã có đơn "Mua cho" lệnh này khác khổ/ĐVT (lỗi #23): không mở đề nghị mua lần hai.
          const khacQc = cauMuaKhacQuyCach(d.mua_khac_quy_cach);
          const tickDuoc = canMua && d.tinh_trang === "can_mua" && !chuaKhai && khacQc.length === 0;
          const ghiChu = [...khacQc, ...d.ghi_chu];
          const da = chon.has(d.khoa);
          return (
            <tr key={d.khoa} className={`row lds-dong${da ? " sel" : ""}`}>
              <td>
                {!chuaKhai && (
                  <input type="checkbox" className="lvt-cb" checked={da} disabled={!tickDuoc}
                    aria-label={`Chọn ${d.hang_ten} của ${d.ma}`}
                    title={tickDuoc ? "Chọn để đề nghị mua" : khacQc.length ? khacQc.join("\n") : d.tinh_trang === "dang_mua" ? "Đã có phiếu mua" : undefined}
                    onChange={() => onChon(d.khoa)} />
                )}
              </td>
              <td>
                {xem === "lenh" ? (
                  <button type="button" className="lvt-lk lvt-lk--chu" onClick={() => onMoHang(d)}>
                    <TenHang d={d} />
                  </button>
                ) : (
                  <span className="lvt-dutu">
                    <button type="button" className="lvt-lk" onClick={() => onMoLenh(d)}>{d.ma}</button>
                    {d.ngoai_pham_vi && <span className="lvt-k" title="Lệnh không còn trong kế hoạch">Ra khỏi kế hoạch</span>}
                  </span>
                )}
              </td>
              <td className="n">{so(d.can)}{xem === "lenh" && <span className="lvt-u">{d.dvt}</span>}</td>
              <td className={`n${d.da_giu ? "" : " lvt-mu"}`}>{so(d.da_giu)}</td>
              <td className={`n${d.con_thieu > 0 ? " red" : " lvt-mu"}`}>{so(d.con_thieu)}</td>
              <td>{chuaKhai && !d.phieu ? <ChuaKhaiDonVi d={d} /> : <OPhieu d={d} moPhieu={moPhieu} />}</td>
              <td>{d.phieu ? <Buoc b={d.phieu.buoc} /> : <span className="lvt-mu3">—</span>}</td>
              <td><NgayCoHang d={d} /></td>
              <td><Chip t={d.tinh_trang} /></td>
              <td title={ghiChu.join("\n")}><GhiChu ds={ghiChu} /></td>
            </tr>
          );
        })}
    </>
  );
}

// ============================================================================
function HopHuyPhieu({
  p, onXong, onHuy,
}: {
  p: LuoiPhieu | null;
  onXong: () => void;
  onHuy: () => void;
}) {
  const { token } = useAuth();
  const [lyDo, setLyDo] = useState("");
  const [ban, setBan] = useState(false);
  const [loi, setLoi] = useState<string | null>(null);
  useEffect(() => {
    setLyDo(p?.ly_do ? `Không cần nữa: ${p.ly_do}` : "");
    setLoi(null);
  }, [p]);
  return (
    <ConfirmDialog open={!!p} danger busy={ban} title={`Huỷ phiếu ${p?.yc_ma ?? ""}?`}
      confirmLabel="Huỷ phiếu" cancelLabel="Thôi"
      onCancel={onHuy}
      onConfirm={async () => {
        if (!token || !p) return;
        if (!lyDo.trim()) {
          setLoi("Nhập lý do huỷ.");
          return;
        }
        setBan(true);
        try {
          await api.departmentPurchaseRequests.cancelLine(token, p.yc_id, p.yc_line_id, lyDo.trim());
          onXong();
        } catch (e: unknown) {
          setLoi(e instanceof ApiError ? e.message : String(e));
        } finally {
          setBan(false);
        }
      }}>
      <p className="lvt-hop">Món này bị bỏ khỏi yêu cầu. Các món khác của yêu cầu vẫn giữ nguyên.</p>
      <label className="lvt-hop__o">
        <span>Lý do</span>
        <input value={lyDo} onChange={(e) => setLyDo(e.target.value)} aria-label="Lý do huỷ phiếu" />
      </label>
      {loi && <p className="lvt-hop__loi" role="alert">{loi}</p>}
    </ConfirmDialog>
  );
}

function LichSu({ ds }: { ds: { luc: string | null; chu: string }[] }) {
  if (!ds.length) return <p className="lvt-mu">Chưa có việc gì.</p>;
  return (
    <ul className="lvt-hist">
      {ds.map((x, i) => (
        <li key={i}>
          <span>{ngayGio(x.luc)}</span>
          <span>{x.chu}</span>
        </li>
      ))}
    </ul>
  );
}

// ============================================================================
function NganLenh({
  chu, hoiNhaNgay, eventTick, coGiu, coHuy, moPhieu, onOpenLsx, onDong, onDoi,
}: {
  chu: { lsx_id: number | null; bai_ghep_id: number | null };
  /** Mở ngăn từ nút "Nhả hàng" của dòng lệnh ⇒ hộp hỏi nhả bật luôn. */
  hoiNhaNgay?: boolean;
  eventTick: number;
  coGiu: boolean;
  coHuy: boolean;
  moPhieu: MoPhieu;
  onOpenLsx?: (id: number) => void;
  onDong: () => void;
  onDoi: () => void;
}) {
  const { token } = useAuth();
  const [tab, setTab] = useState("vt");
  const [d, setD] = useState<{ lenh: LuoiLenh; dong: LuoiDong[] } | null>(null);
  const [loi, setLoi] = useState<string | null>(null);
  const [hoiNha, setHoiNha] = useState(!!hoiNhaNgay);
  const [ban, setBan] = useState(false);
  const [huy, setHuy] = useState<LuoiPhieu | null>(null);

  useEffect(() => {
    if (!token) return;
    api.keHoachVatTu.luoiLenh(token, chu).then((r) => {
      setD(r);
      setLoi(null);
    }).catch((e: unknown) => setLoi(e instanceof ApiError ? e.message : String(e)));
  }, [token, chu, eventTick]);

  const l = d?.lenh;
  const dangGiu = (d?.dong ?? []).filter((x) => x.giu_kho + x.giu_ve > 0);
  const phieu = (d?.dong ?? []).filter((x) => x.phieu);
  const trung = (d?.dong ?? []).flatMap((x) => x.trung.map((p) => ({ p, d: x })));

  async function doiGiu(batGiu: boolean) {
    if (!token || !l) return;
    setBan(true);
    try {
      await api.keHoachVatTu.giuCho(token, batGiu, l);
      setHoiNha(false);
      onDoi();
      // Lệnh ngoài kế hoạch nhả xong là rời lưới — để ngăn mở thì lần nạp lại chỉ ra lỗi 404.
      if (!batGiu && l.ngoai_pham_vi) onDong();
    } catch (e: unknown) {
      setLoi(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBan(false);
    }
  }

  return (
    <NganPhai
      tieuDe={l?.ma ?? "Lệnh"}
      phuDe={l && (
        <span className="lvt-dau">
          {l.ten_sp && <span>{l.ten_sp}</span>}
          {l.khach_ten && <span className="lvt-tag">{l.khach_ten}</span>}
          {l.han_giao_khach && <span className="lvt-mu">Giao {ngayNgan(l.han_giao_khach)}</span>}
        </span>
      )}
      hanhDong={l?.lsx_id && onOpenLsx ? (
        <button type="button" className="lvt-btn" onClick={() => onOpenLsx(l.lsx_id!)}>
          <Link2 size={14} aria-hidden="true" />
          Mở lệnh SX
        </button>
      ) : undefined}
      tabs={[{ id: "vt", nhan: "Vật tư" }, { id: "pm", nhan: "Phiếu mua" }, { id: "ls", nhan: "Lịch sử" }]}
      tab={tab}
      onTab={setTab}
      onDong={onDong}
      chan={l && coGiu ? (
        <>
          {/* Lệnh đã tắt giữ mà còn hàng giữ sót (vd. rơi khỏi kế hoạch) vẫn phải có nút nhả. */}
          {l.bat || dangGiu.length > 0 ? (
            <button type="button" className="lvt-btn lvt-btn--danger" onClick={() => setHoiNha(true)}>Nhả hàng đã giữ</button>
          ) : (
            <button type="button" className="lvt-btn" disabled={ban} onClick={() => void doiGiu(true)}>
              {ban ? "Đang giữ…" : "Giữ hàng"}
            </button>
          )}
          <span className="lvt-sp" />
          <button type="button" className="lvt-btn" onClick={onDong}>Đóng</button>
        </>
      ) : undefined}
    >
      {loi && <div className="banner banner--error" role="alert">{loi}</div>}
      {!d && !loi && <p className="lvt-mu">Đang tải…</p>}
      {d && tab === "vt" && (
        <div className="lvt-sheet lvt-cuon">
          {/* Bước của phiếu nằm ở tab Phiếu mua — ở đây nhường chỗ cho Ghi chú để cột Tình trạng
              không bị cắt ở bề ngang ngăn mặc định. */}
          <table className="lvt-g lvt-g--ngan">
            <colgroup>
              <col style={{ width: 178 }} /><col style={{ width: 204 }} /><col style={{ width: 88 }} />
              <col style={{ width: 64 }} /><col style={{ width: 80 }} /><col style={{ width: 160 }} />
              <col style={{ width: 104 }} /><col style={{ width: 156 }} /><col />
            </colgroup>
            <thead>
              <tr>
                <th>Mặt hàng</th><th>Công đoạn</th><th className="n">Cần</th><th className="n" title={TIEU_DE_DA_CO}>Đã có</th>
                <th className="n">Còn thiếu</th><th>Phiếu mua</th><th>Ngày có hàng</th><th>Tình trạng</th><th>Ghi chú</th>
              </tr>
            </thead>
            <tbody>
              {d.dong.map((x) => {
                const congDoan = x.buoc.map((b) => b.ten_viec ?? "—");
                return (
                  <tr key={x.khoa} className="row">
                    <td><TenHang d={x} /></td>
                    <td title={congDoan.join("\n")}>
                      <span className="lvt-cd">
                        {congDoan.map((t, i) => <span key={x.buoc[i].buoc_id ?? i}>{t}</span>)}
                      </span>
                    </td>
                    <td className="n">{so(x.can)}<span className="lvt-u">{x.dvt}</span></td>
                    <td className={`n${x.da_giu ? "" : " lvt-mu"}`}>{so(x.da_giu)}</td>
                    <td className={`n${x.con_thieu > 0 ? " red" : " lvt-mu"}`}>{so(x.con_thieu)}</td>
                    <td><OPhieu d={x} moPhieu={moPhieu} /></td>
                    <td><NgayCoHang d={x} /></td>
                    <td><Chip t={x.tinh_trang} /></td>
                    <td title={x.ghi_chu.join("\n")}><GhiChu ds={x.ghi_chu} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {d && tab === "pm" && (
        <>
          <div className="lvt-sec">Phiếu đang lo cho lệnh</div>
          {phieu.length === 0 ? (
            <p className="lvt-mu">Lệnh này chưa có phiếu mua nào.</p>
          ) : (
            <div className="lvt-sheet">
              <table className="lvt-g">
                <colgroup>
                  <col style={{ width: 180 }} /><col style={{ width: 220 }} /><col style={{ width: 180 }} />
                  <col style={{ width: 120 }} /><col style={{ width: 200 }} /><col />
                </colgroup>
                <thead>
                  <tr><th>Phiếu mua</th><th>Mặt hàng</th><th>Lập từ yêu cầu</th><th className="n">Đặt cho lệnh</th><th>Bước của phiếu</th><th>Ngày có hàng</th></tr>
                </thead>
                <tbody>
                  {phieu.map((x) => (
                    <tr key={x.khoa} className="row">
                      <td><button type="button" className="lvt-lk" onClick={() => moPhieu(x.phieu!)}>{x.phieu!.ma}</button></td>
                      <td><TenHang d={x} /></td>
                      <td>{x.phieu!.loai === "pmh" ? x.phieu!.yc_ma : <span className="lvt-mu">chính phiếu này</span>}</td>
                      <td className="n">{so(x.phieu!.phan)}<span className="lvt-u">{x.dvt}</span></td>
                      <td><Buoc b={x.phieu!.buoc} /></td>
                      <td><NgayCoHang d={x} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {trung.length > 0 && (
            <>
              <div className="lvt-sec">Phiếu trùng nên huỷ <span className="lvt-mu3">vì món đã có phiếu ở trên</span></div>
              <div className="lvt-sheet">
                <table className="lvt-g">
                  <colgroup><col style={{ width: 180 }} /><col style={{ width: 220 }} /><col style={{ width: 200 }} /><col /></colgroup>
                  <thead><tr><th>Phiếu</th><th>Mặt hàng</th><th>Bước của phiếu</th><th /></tr></thead>
                  <tbody>
                    {trung.map(({ p, d: x }) => (
                      <tr key={`${x.khoa}-${p.yc_line_id}`} className="row">
                        <td><button type="button" className="lvt-lk" onClick={() => moPhieu(p)}>{p.ma}</button></td>
                        <td><TenHang d={x} /></td>
                        <td>{NHAN_BUOC[p.buoc]}</td>
                        <td className="n">
                          {coHuy && p.co_the_huy ? (
                            <button type="button" className="lvt-btn lvt-btn--xs lvt-btn--danger"
                              onClick={() => setHuy({ ...p, ly_do: `trùng với phiếu ${x.phieu?.ma ?? ""}` })}>
                              Huỷ phiếu
                            </button>
                          ) : !p.co_the_huy ? (
                            <span className="lvt-mu">đơn đang chạy, huỷ ở màn Mua hàng</span>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
      {d && tab === "ls" && <LichSu ds={d.lenh.lich_su} />}

      <ConfirmDialog open={hoiNha} danger busy={ban} title={`Nhả hàng đã giữ của ${l?.ma ?? ""}?`}
        confirmLabel="Nhả hàng" cancelLabel="Thôi" onCancel={() => setHoiNha(false)}
        onConfirm={() => void doiGiu(false)}>
        {dangGiu.length === 0 ? (
          <p className="lvt-hop">Lệnh này chưa giữ được món nào. Nhả chỉ tắt việc tự giữ khi hàng về.</p>
        ) : (
          <>
            {/* Hàng giữ có thể còn đang về chứ chưa vào kho — nói đúng nguồn từng món. */}
            <p className="lvt-hop">Thôi giữ cho lệnh này:</p>
            <ul className="lvt-hop__ds">
              {dangGiu.map((x) => (
                <li key={x.khoa}>
                  <span>{so(x.giu_kho + x.giu_ve)} {x.dvt}</span>
                  <span>{x.hang_ten}</span>
                  <span className="lvt-mu">
                    {x.giu_kho > 0 && x.giu_ve > 0 ? "trong kho và hàng đang về"
                      : x.giu_kho > 0 ? "trong kho" : "hàng đang về"}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
        <p className="lvt-hop">Lệnh khác cần sớm hơn sẽ giữ phần vừa nhả, giữ lại sau có thể không còn.</p>
      </ConfirmDialog>
      <HopHuyPhieu p={huy} onHuy={() => setHuy(null)} onXong={() => { setHuy(null); onDoi(); }} />
    </NganPhai>
  );
}

// ============================================================================
function NganHang({
  h, eventTick, coHuy, moPhieu, onMoLenh, onDong, onDoi,
}: {
  h: { hang_loai: "giay" | "vat_tu"; hang_id: number; kho_rong: number; kho_dai: number; don_vi_goc: string };
  eventTick: number;
  coHuy: boolean;
  moPhieu: MoPhieu;
  onMoLenh: (d: LuoiDong) => void;
  onDong: () => void;
  onDoi: () => void;
}) {
  const { token } = useAuth();
  const [tab, setTab] = useState("dm");
  const [d, setD] = useState<{ hang: LuoiHang; dong: LuoiDong[] } | null>(null);
  const [loi, setLoi] = useState<string | null>(null);
  const [huy, setHuy] = useState<LuoiPhieu | null>(null);

  useEffect(() => {
    if (!token) return;
    api.keHoachVatTu.luoiHang(token, h).then((r) => {
      setD(r);
      setLoi(null);
    }).catch((e: unknown) => setLoi(e instanceof ApiError ? e.message : String(e)));
  }, [token, h, eventTick]);

  const v = d?.hang;
  return (
    <NganPhai
      tieuDe={v ? <TenHang d={v} /> : "Mặt hàng"}
      the={v ? <span className="lvt-kind">{v.hang_loai === "giay" ? "Giấy" : "Vật tư"}</span> : undefined}
      phuDe={v && (
        <span className="lvt-kv">
          <span>Cần cho lệnh<b>{so(v.can)}</b></span>
          <span title={TIEU_DE_DA_CO}>Đã có<b>{so(v.da_giu)}</b></span>
          <span>Còn thiếu<b className={v.con_thieu > 0 ? "red" : undefined}>{so(v.con_thieu)}</b></span>
          <span>Tồn kho<b>{so(v.ton)}</b></span>
          <span>Đang về<b>{so(v.dang_ve)}</b></span>
          <span className="lvt-mu">{v.dvt}</span>
          <CungKhoKhac ds={v.cung_kho_khac_don_vi} />
          {v.ghi_chu.length > 0 && <GhiChu ds={v.ghi_chu} />}
        </span>
      )}
      tabs={[{ id: "dm", nhan: "Đơn mua" }, { id: "ld", nhan: "Lệnh dùng" }, { id: "ls", nhan: "Lịch sử" }]}
      tab={tab}
      onTab={setTab}
      onDong={onDong}
      chan={<><span className="lvt-sp" /><button type="button" className="lvt-btn" onClick={onDong}>Đóng</button></>}
    >
      {loi && <div className="banner banner--error" role="alert">{loi}</div>}
      {!d && !loi && <p className="lvt-mu">Đang tải…</p>}
      {v && tab === "dm" && (
        <>
          <div className="lvt-sec">Đơn đang chạy</div>
          {v.don.length === 0 ? (
            <p className="lvt-mu">Không có đơn mua nào đang chạy.</p>
          ) : (
            <div className="lvt-sheet">
              <table className="lvt-g">
                <colgroup>
                  <col style={{ width: 150 }} /><col style={{ width: 182 }} /><col style={{ width: 100 }} />
                  <col style={{ width: 76 }} /><col style={{ width: 190 }} /><col style={{ width: 64 }} />
                  <col /><col style={{ width: 116 }} />
                </colgroup>
                <thead>
                  <tr><th>Đơn mua</th><th>Bước của phiếu</th><th>Ngày về</th><th className="n">Còn về</th><th>Đặt cho lệnh</th><th className="n">Dư</th><th>Phần dư đang giữ cho</th><th className="n">Dư chưa ai giữ</th></tr>
                </thead>
                <tbody>
                  {v.don.map((x, i) => (
                    <tr key={`${x.ma}-${i}`} className="row">
                      <td>{x.ma ? <button type="button" className="lvt-lk" onClick={() => moPhieu({ ma: x.ma!, loai: "pmh", yc_ma: "" })}>{x.ma}</button> : "—"}</td>
                      <td><Buoc b={x.buoc} /></td>
                      <td>{x.da_dat ? ngayNgan(x.ngay_ve) : <span className="lvt-mu">{x.ngay_ve ? `hẹn ${ngayNgan(x.ngay_ve, false)}` : "—"}</span>}</td>
                      <td className="n">{so(x.so)}</td>
                      <td title={x.dat_cho.map((o) => `${o.ma} ${so(o.so)}`).join("\n") || undefined}>
                        {x.dat_cho.length === 0 ? <span className="lvt-mu3">không đặt cho lệnh nào</span> : (
                          <span className="lvt-cap">{x.dat_cho.map((o) => <span key={o.ma}>{o.ma} <span className="lvt-mu">{so(o.so)}</span></span>)}</span>
                        )}
                      </td>
                      <td className={`n${x.da_dat ? "" : " lvt-mu"}`}>{so(x.du)}</td>
                      <td title={x.giu_du.map((o) => `${o.ma} ${so(o.so)}`).join("\n") || undefined}>
                        {!x.da_dat ? <span className="lvt-mu3">chưa đặt hàng nên chưa giữ</span>
                          : x.giu_du.length === 0 ? <span className="lvt-mu3">—</span>
                            : <span className="lvt-cap">{x.giu_du.map((o) => <span key={o.ma}>{o.ma} <span className="lvt-mu">{so(o.so)}</span></span>)}</span>}
                      </td>
                      <td className={`n${x.da_dat && x.du_trong > 0 ? " lvt-amb" : " lvt-mu"}`}>{so(x.du_trong)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {v.nen_huy.length > 0 && (
            <>
              <div className="lvt-sec">Phiếu nên huỷ</div>
              <div className="lvt-sheet">
                <table className="lvt-g">
                  <colgroup><col style={{ width: 180 }} /><col style={{ width: 160 }} /><col style={{ width: 150 }} /><col /><col style={{ width: 120 }} /></colgroup>
                  <thead><tr><th>Phiếu</th><th>Bước của phiếu</th><th>Lập cho</th><th>Vì sao nên huỷ</th><th /></tr></thead>
                  <tbody>
                    {v.nen_huy.map((p) => (
                      <tr key={p.yc_line_id} className="row">
                        <td><button type="button" className="lvt-lk" onClick={() => moPhieu(p)}>{p.ma}</button></td>
                        <td>{NHAN_BUOC[p.buoc]}</td>
                        <td>
                          {p.lap_cho.length ? <span className="lvt-cap">{p.lap_cho.map((m) => <span key={m}>{m}</span>)}</span>
                            : <span className="lvt-mu3">không lệnh nào</span>}
                        </td>
                        <td className="lvt-mu">{p.ly_do}</td>
                        <td className="n">
                          {coHuy && p.co_the_huy ? (
                            <button type="button" className="lvt-btn lvt-btn--xs lvt-btn--danger" onClick={() => setHuy(p)}>Huỷ phiếu</button>
                          ) : !p.co_the_huy ? <span className="lvt-mu">huỷ ở màn Mua hàng</span> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
      {d && tab === "ld" && (
        <div className="lvt-sheet">
          <table className="lvt-g">
            <colgroup>
              <col style={{ width: 130 }} /><col style={{ width: 210 }} /><col style={{ width: 76 }} />
              <col style={{ width: 64 }} /><col style={{ width: 80 }} /><col style={{ width: 170 }} />
              <col style={{ width: 104 }} /><col style={{ width: 156 }} /><col />
            </colgroup>
            <thead>
              <tr><th>Lệnh</th><th>Công đoạn</th><th className="n">Cần</th><th className="n" title={TIEU_DE_DA_CO}>Đã có</th><th className="n">Còn thiếu</th><th>Phiếu mua</th><th>Ngày có hàng</th><th>Tình trạng</th><th>Ghi chú</th></tr>
            </thead>
            <tbody>
              {d.dong.map((x) => (
                <tr key={x.khoa} className="row">
                  <td><button type="button" className="lvt-lk" onClick={() => onMoLenh(x)}>{x.ma}</button></td>
                  <td title={x.buoc.map((b) => b.ten_viec ?? "—").join(" + ")}>
                    <span className="lvt-cd">{x.buoc.map((b, i) => <span key={b.buoc_id ?? i}>{b.ten_viec ?? "—"}</span>)}</span>
                  </td>
                  <td className="n">{so(x.can)}</td>
                  <td className={`n${x.da_giu ? "" : " lvt-mu"}`}>{so(x.da_giu)}</td>
                  <td className={`n${x.con_thieu > 0 ? " red" : " lvt-mu"}`}>{so(x.con_thieu)}</td>
                  <td><OPhieu d={x} moPhieu={moPhieu} /></td>
                  <td><NgayCoHang d={x} /></td>
                  <td><Chip t={x.tinh_trang} /></td>
                  <td title={x.ghi_chu.join(" + ")}><GhiChu ds={x.ghi_chu} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {v && tab === "ls" && <LichSu ds={v.lich_su} />}
      <HopHuyPhieu p={huy} onHuy={() => setHuy(null)} onXong={() => { setHuy(null); onDoi(); }} />
    </NganPhai>
  );
}
