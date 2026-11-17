// Tab "Phiếu giao" của màn Thuê gia công (spec 2026-11-13 §4.3): mọi lần giao hàng cho nhà gia công, kỳ
// theo ngày giao, lọc còn hiệu lực / đã huỷ và nhà gia công. Tìm, lọc, đếm, cắt trang ở MÁY CHỦ.
import { useEffect, useMemo, useState } from "react";
import { Building2 } from "lucide-react";
import { ApiError } from "../../api/client";
import { tgcApi, type TgcNhaGiaCong, type TgcPhieuGiao, type TgcPhieuGiaoListOut } from "../../api/thueGiaCong";
import { useAuth } from "../../auth/useAuth";
import { EmptyRow } from "../../components/EmptyState";
import {
  ChipTT, ChonCot, CuonLuoi, LocNhanhTrangThai, OTim, rongLuoi, useCauHinhLuoi, type CotLuoi,
} from "../../components/LuoiDs";
import { PhanTrangDayDu } from "../../components/PhanTrangDayDu";
import { useDebounced } from "../../utils/useDebounced";
import { ngayDayDu, ngayGioDayDu } from "../loc-san-xuat/ngay";
import { nhanChang, nhanDonVi } from "../lsxBuoc";
import { ThanhLoc } from "../thanh-loc/ThanhLoc";
import { thamSoKy, type KyDS } from "../thanh-loc/ky-danh-sach";
import type { DieuKien } from "../thanh-loc/thanh-loc";
import { so } from "./tgc";

type Nhanh = "tat_ca" | "con_hieu_luc" | "da_huy";
const NHAN_NHANH: Record<Nhanh, string> = { tat_ca: "Tất cả", con_hieu_luc: "Còn hiệu lực", da_huy: "Đã huỷ" };
const MOC_PG: [string, string][] = [["giao", "Ngày giao"]];

interface CotPg extends CotLuoi { w?: number; n?: boolean }
export const COT_PG: CotPg[] = [
  { key: "ma", label: "Mã phiếu", coDinh: true, w: 110 },
  { key: "don", label: "Đơn", w: 110 },
  { key: "nha", label: "Nhà gia công", w: 200 },
  { key: "lenh", label: "Lệnh", w: 130 },
  { key: "btp", label: "Bán thành phẩm", n: true, w: 140 },
  { key: "vt", label: "Vật tư, giấy", w: 200 },
  { key: "tt", label: "Tình trạng", w: 130 },
  { key: "giao", label: "Giao lúc", w: 140 },
  { key: "nguoi", label: "Người giao", w: 130 },
  { key: "ngay", label: "Ngày tạo", w: 104 },
];

type Loc = { nha?: string };

function OPg({ cot, p }: { cot: string; p: TgcPhieuGiao }) {
  const btp = p.dong.filter((x) => x.loai === "ban_thanh_pham");
  const vt = p.dong.filter((x) => x.loai === "vat_tu");
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
    case "btp": {
      if (btp.length === 0) return <td className="n"><span className="lds-mu3">—</span></td>;
      const dv = new Set(btp.map((x) => x.don_vi ?? ""));
      return dv.size === 1
        ? <td className="n">{so(btp.reduce((s, x) => s + x.so_luong, 0))}<span className="lds-u">{nhanChang(btp[0].don_vi)}</span></td>
        : <td className="n">{btp.map((x) => <span key={x.id} className="tgc-u">{so(x.so_luong)} {nhanChang(x.don_vi)}</span>)}</td>;
    }
    case "vt":
      return (
        <td title={vt.map((x) => `${x.ten_hang ?? ""} ${so(x.so_luong)} ${nhanDonVi(x.don_vi)}`).join("\n")}>
          {vt.length === 0 ? <span className="lds-mu3">—</span> : <>
            {vt[0].ten_hang}
            <span className="tgc-u">{so(vt[0].so_luong)} {nhanDonVi(vt[0].don_vi)}</span>
            {vt.length > 1 && <span className="tgc-u">{`và ${vt.length - 1} món khác`}</span>}
          </>}
        </td>
      );
    case "tt":
      return <td>{p.huy_luc ? <ChipTT mau="do">Đã huỷ</ChipTT> : <ChipTT mau="la">Còn hiệu lực</ChipTT>}</td>;
    case "giao":
      return <td>{ngayGioDayDu(p.giao_luc)}</td>;
    case "nguoi":
      return <td>{p.nguoi_giao_ten ?? "—"}</td>;
    case "ngay":
      return <td className="lds-mu" title={ngayGioDayDu(p.created_at)}>{ngayDayDu(p.created_at)}</td>;
    default:
      return <td />;
  }
}

export function PhieuGiaoTab({
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
  const luoi = useCauHinhLuoi("tgc-phieu-giao");
  const cotHien = luoi.rongHien(luoi.xep(COT_PG).filter((c) => !luoi.an.has(c.key)));
  const [tim, setTim] = useState("");
  const timCham = useDebounced(tim.trim());
  const [nhanh, setNhanh] = useState<Nhanh>("tat_ca");
  const [ky, setKy] = useState<KyDS>({ loai: "tat_ca", moc: "giao" });
  const [loc, setLoc] = useState<Loc>({});
  const [trang, setTrang] = useState(1);
  const [coTrang, setCoTrang] = useState(25);
  const [data, setData] = useState<TgcPhieuGiaoListOut | null>(null);
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
    tgcApi.dsPhieuGiao(token, {
      page: trang, size: coTrang, q: timCham || undefined,
      con_hieu_luc: nhanh === "tat_ca" ? undefined : nhanh === "con_hieu_luc",
      nha_cung_cap_id: loc.nha ? Number(loc.nha) : undefined, ...kySo,
    })
      .then((r) => { if (alive) { setData(r); setLoi(null); onDanhSach?.(r.items.map((x) => x.id)); } })
      .catch((e) => { if (alive) setLoi(e instanceof ApiError ? e.message : "Không tải được phiếu giao."); })
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
    <section aria-label="Phiếu giao">
      <section className="lds-loc">
        <LocNhanhTrangThai
          muc={(["tat_ca", "con_hieu_luc", "da_huy"] as Nhanh[]).map((k) => ({
            key: k, label: NHAN_NHANH[k], mau: k === "tat_ca" ? undefined : k === "da_huy" ? "do" : "la", count: dem[k],
          }))}
          dang={nhanh}
          onChon={(k) => setNhanh(k as Nhanh)}
          ariaLabel="Lọc phiếu giao theo tình trạng"
        />
        <div className="lds-loc__thanh tl-thanh" role="search">
          <OTim value={tim} onChange={setTim} placeholder="Tìm mã phiếu, mã đơn, nhà gia công, mã lệnh…" ariaLabel="Tìm phiếu giao" />
          <ThanhLoc ky={ky} moc={MOC_PG} onKy={setKy} dieuKien={dieuKien} loc={loc} onLoc={setLoc} />
          <span className="kcsb-gian" />
          <ChonCot cot={COT_PG} {...luoi.chonCot} />
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
                      ? "Không có phiếu giao nào khớp điều kiện đang lọc."
                      : "Chưa giao hàng lần nào. Mở một đơn đã đặt rồi bấm Giao hàng."}
                  </td>
                </tr>
              ) : (
                data.items.map((p) => (
                  <tr key={p.id} className={`lds-dong lds-dong--bam${dangMo === p.id ? " is-mo" : ""}`}
                    tabIndex={0} onClick={() => onMo(p.id)}
                    onKeyDown={(e) => { if (e.key === "Enter") onMo(p.id); }}>
                    {cotHien.map((c) => <OPg key={c.key} cot={c.key} p={p} />)}
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
          loading={loading} donVi="phiếu" ariaLabel="Phân trang phiếu giao" />
      )}
    </section>
  );
}
