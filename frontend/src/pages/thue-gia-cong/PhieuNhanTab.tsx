// Tab "Phiếu nhận" của màn Thuê gia công (spec 2026-11-13 §4.4): mọi lần nhận hàng từ nhà gia công, kỳ
// theo ngày nhận, lọc còn hiệu lực / đã huỷ và nhà gia công. Tìm, lọc, đếm, cắt trang ở MÁY CHỦ.
import { useEffect, useMemo, useState } from "react";
import { Building2 } from "lucide-react";
import { ApiError } from "../../api/client";
import { tgcApi, type TgcNhaGiaCong, type TgcPhieuNhan, type TgcPhieuNhanListOut } from "../../api/thueGiaCong";
import { useAuth } from "../../auth/useAuth";
import { EmptyRow } from "../../components/EmptyState";
import {
  ChipTT, ChonCot, CuonLuoi, LocNhanhTrangThai, OTim, rongLuoi, useCauHinhLuoi, type CotLuoi,
} from "../../components/LuoiDs";
import { PhanTrangDayDu } from "../../components/PhanTrangDayDu";
import { useDebounced } from "../../utils/useDebounced";
import { ngayDayDu, ngayGioDayDu } from "../loc-san-xuat/ngay";
import { nhanChang } from "../lsxBuoc";
import { ThanhLoc } from "../thanh-loc/ThanhLoc";
import { thamSoKy, type KyDS } from "../thanh-loc/ky-danh-sach";
import type { DieuKien } from "../thanh-loc/thanh-loc";
import { NHAN_NOI_VE } from "./PhieuNhanForm";
import { so, tien } from "./tgc";

type Nhanh = "tat_ca" | "con_hieu_luc" | "da_huy";
const NHAN_NHANH: Record<Nhanh, string> = { tat_ca: "Tất cả", con_hieu_luc: "Còn hiệu lực", da_huy: "Đã huỷ" };
const MOC_PN: [string, string][] = [["nhan", "Ngày nhận"]];

interface CotPn extends CotLuoi { w?: number; n?: boolean }
export const COT_PN: CotPn[] = [
  { key: "ma", label: "Mã phiếu", coDinh: true, w: 110 },
  { key: "don", label: "Đơn", w: 110 },
  { key: "nha", label: "Nhà gia công", w: 200 },
  { key: "lenh", label: "Lệnh", w: 130 },
  { key: "dat", label: "Đạt", n: true, w: 110 },
  { key: "hong", label: "Hỏng", n: true, w: 90 },
  { key: "noi", label: "Nơi về", w: 150 },
  { key: "tien", label: "Tạm tính", n: true, w: 120 },
  { key: "tt", label: "Tình trạng", w: 130 },
  { key: "nhan", label: "Nhận lúc", w: 140 },
  { key: "nguoi", label: "Người nhận", w: 130 },
  { key: "ngay", label: "Ngày tạo", w: 104 },
];

type Loc = { nha?: string };

function tongSo(p: TgcPhieuNhan, k: "sl_dat" | "sl_hong") {
  const dv = new Set(p.dong.map((x) => x.don_vi ?? ""));
  if (dv.size !== 1) return null;
  return { so: p.dong.reduce((s, x) => s + x[k], 0), dv: p.dong[0]?.don_vi ?? null };
}

function OPn({ cot, p }: { cot: string; p: TgcPhieuNhan }) {
  switch (cot) {
    case "ma":
      return <td>{p.ma}</td>;
    case "don":
      return <td>{p.ma_don}</td>;
    case "nha":
      return <td title={p.nha_cung_cap_ten}>{p.nha_cung_cap_ten}</td>;
    case "lenh":
      return (
        <td title={p.lenh.map((l) => l.lsx_ma).join("\n")}>
          {p.lenh[0]?.lsx_ma ?? "—"}
          {p.lenh.length > 1 && <span className="tgc-u">{`và ${p.lenh.length - 1} lệnh khác`}</span>}
        </td>
      );
    case "dat":
    case "hong": {
      const t = tongSo(p, cot === "dat" ? "sl_dat" : "sl_hong");
      if (t == null) {
        return <td className="n">{p.dong.map((x) => (
          <span key={x.id} className="tgc-u">{so(cot === "dat" ? x.sl_dat : x.sl_hong)} {nhanChang(x.don_vi)}</span>
        ))}</td>;
      }
      return t.so > 0
        ? <td className="n">{so(t.so)}<span className="lds-u">{nhanChang(t.dv)}</span></td>
        : <td className="n"><span className="lds-mu3">—</span></td>;
    }
    case "noi": {
      const noi = [...new Set(p.dong.map((x) => x.dich_ten ?? NHAN_NOI_VE[x.noi_ve]))];
      return <td title={noi.join("\n")}>{noi[0]}{noi.length > 1 && <span className="tgc-u">{`và ${noi.length - 1} nơi khác`}</span>}</td>;
    }
    case "tien":
      return <td className="n">{tien(p.tam_tinh)}</td>;
    case "tt":
      return (
        <td>
          {p.huy_luc ? <ChipTT mau="do">Đã huỷ</ChipTT>
            : p.phieu_chi_ma ? <ChipTT mau="xanh">Đã chi</ChipTT> : <ChipTT mau="la">Còn hiệu lực</ChipTT>}
        </td>
      );
    case "nhan":
      return <td>{ngayGioDayDu(p.nhan_luc)}</td>;
    case "nguoi":
      return <td>{p.nguoi_nhan_ten ?? "—"}</td>;
    case "ngay":
      return <td className="lds-mu" title={ngayGioDayDu(p.created_at)}>{ngayDayDu(p.created_at)}</td>;
    default:
      return <td />;
  }
}

export function PhieuNhanTab({
  eventTick,
  tick,
  dangMo,
  onMo,
  onDanhSach,
}: {
  eventTick?: number;
  tick?: number;
  dangMo?: number | null;
  onMo: (id: number) => void;
  onDanhSach?: (ids: number[]) => void;
}) {
  const { token } = useAuth();
  const luoi = useCauHinhLuoi("tgc-phieu-nhan");
  const cotHien = luoi.rongHien(luoi.xep(COT_PN).filter((c) => !luoi.an.has(c.key)));
  const [tim, setTim] = useState("");
  const timCham = useDebounced(tim.trim());
  const [nhanh, setNhanh] = useState<Nhanh>("tat_ca");
  const [ky, setKy] = useState<KyDS>({ loai: "tat_ca", moc: "nhan" });
  const [loc, setLoc] = useState<Loc>({});
  const [trang, setTrang] = useState(1);
  const [coTrang, setCoTrang] = useState(25);
  const [data, setData] = useState<TgcPhieuNhanListOut | null>(null);
  const [loading, setLoading] = useState(true);
  const [loi, setLoi] = useState<string | null>(null);
  const [thuLai, setThuLai] = useState(0);
  const [nhas, setNhas] = useState<TgcNhaGiaCong[]>([]);

  useEffect(() => {
    if (token) tgcApi.nhaGiaCong(token, true).then(setNhas).catch(() => setNhas([]));
  }, [token]);
  useEffect(() => { setTrang(1); }, [timCham, nhanh, ky, loc]);
  useEffect(() => {
    if (!token) return;
    let alive = true;
    setLoading(true);
    const { moc: _moc, ...kySo } = thamSoKy(ky);
    tgcApi.dsPhieuNhan(token, {
      page: trang, size: coTrang, q: timCham || undefined,
      con_hieu_luc: nhanh === "tat_ca" ? undefined : nhanh === "con_hieu_luc",
      nha_cung_cap_id: loc.nha ? Number(loc.nha) : undefined, ...kySo,
    })
      .then((r) => { if (alive) { setData(r); setLoi(null); onDanhSach?.(r.items.map((x) => x.id)); } })
      .catch((e) => { if (alive) setLoi(e instanceof ApiError ? e.message : "Không tải được phiếu nhận."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, trang, coTrang, timCham, nhanh, ky, loc, thuLai, tick, eventTick]);

  const dieuKien: DieuKien<Loc>[] = useMemo(() => [{
    khoa: "nha", nhan: "Nhà gia công", icon: Building2, kieu: "mot", tim: true,
    giaTri: nhas.map((n) => ({ value: String(n.id), nhan: n.ten })),
    doc: (l) => l.nha, ghi: (l, v) => ({ ...l, nha: v }),
  }], [nhas]);

  const facets = data?.facets ?? {};
  const dem: Record<Nhanh, number | undefined> = {
    tat_ca: data ? (facets.con_hieu_luc ?? 0) + (facets.da_huy ?? 0) : undefined,
    con_hieu_luc: facets.con_hieu_luc, da_huy: facets.da_huy,
  };

  return (
    <section aria-label="Phiếu nhận">
      <section className="lds-loc">
        <LocNhanhTrangThai
          muc={(["tat_ca", "con_hieu_luc", "da_huy"] as Nhanh[]).map((k) => ({
            key: k, label: NHAN_NHANH[k], mau: k === "tat_ca" ? undefined : k === "da_huy" ? "do" : "la", count: dem[k],
          }))}
          dang={nhanh}
          onChon={(k) => setNhanh(k as Nhanh)}
          ariaLabel="Lọc phiếu nhận theo tình trạng"
        />
        <div className="lds-loc__thanh tl-thanh" role="search">
          <OTim value={tim} onChange={setTim} placeholder="Tìm mã phiếu, mã đơn, nhà gia công, mã lệnh…" ariaLabel="Tìm phiếu nhận" />
          <ThanhLoc ky={ky} moc={MOC_PN} onKy={setKy} dieuKien={dieuKien} loc={loc} onLoc={setLoc} />
          <span className="kcsb-gian" />
          <ChonCot cot={COT_PN} {...luoi.chonCot} />
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
                {cotHien.map((c) => <th key={c.key} className={c.n ? "n" : undefined}>{c.label}{luoi.keo(c.key)}</th>)}
              </tr>
            </thead>
            <tbody>
              {loi ? (
                <tr>
                  <td colSpan={cotHien.length} className="lds-trong">
                    <span className="lds-do">{loi}</span>{" "}
                    <button type="button" className="lds-lk" onClick={() => setThuLai((k) => k + 1)}>Thử lại</button>
                  </td>
                </tr>
              ) : data == null ? (
                <EmptyRow colSpan={cotHien.length} trangThai="dang-tai" />
              ) : data.items.length === 0 ? (
                <tr>
                  <td colSpan={cotHien.length} className="lds-trong">
                    {timCham || nhanh !== "tat_ca" || loc.nha || ky.loai !== "tat_ca"
                      ? "Không có phiếu nhận nào khớp điều kiện đang lọc."
                      : "Chưa nhận hàng lần nào. Mở một đơn đã giao rồi bấm Nhận hàng."}
                  </td>
                </tr>
              ) : (
                data.items.map((p) => (
                  <tr key={p.id} className={`lds-dong lds-dong--bam${dangMo === p.id ? " is-mo" : ""}`}
                    tabIndex={0} onClick={() => onMo(p.id)}
                    onKeyDown={(e) => { if (e.key === "Enter") onMo(p.id); }}>
                    {cotHien.map((c) => <OPn key={c.key} cot={c.key} p={p} />)}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CuonLuoi>
      </div>
      {!loi && data != null && data.items.length > 0 && (
        <PhanTrangDayDu trang={data.page} size={data.size} tong={data.total} soDong={data.items.length}
          onTrang={setTrang} onSize={(n) => { setCoTrang(n); setTrang(1); }}
          loading={loading} donVi="phiếu" ariaLabel="Phân trang phiếu nhận" />
      )}
    </section>
  );
}
