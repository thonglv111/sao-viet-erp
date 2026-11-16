// Tab "Đơn gia công" của màn Thuê gia công (spec 2026-11-13 §4.2): lưới đơn kèm thông tin lệnh, kỳ theo
// ngày đặt / ngày lập / hẹn về, lọc trạng thái (dẫn xuất ở máy chủ) và nhà gia công. Tìm, lọc, đếm, cắt
// trang ở MÁY CHỦ. Bấm dòng mở ngăn đơn.
import { useEffect, useMemo, useState } from "react";
import { Building2 } from "lucide-react";
import { ApiError } from "../../api/client";
import {
  tgcApi, type TgcDon, type TgcDonListOut, type TgcNhaGiaCong, type TgcTrangThaiDon,
} from "../../api/thueGiaCong";
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
import { MAU_TRANG_THAI_DON, NHAN_TRANG_THAI_DON, so, tien } from "./tgc";

type Nhanh = "tat_ca" | TgcTrangThaiDon;
const NHANH: Nhanh[] = ["tat_ca", "nhap", "da_dat", "giao_mot_phan", "giao_du", "ve_mot_phan", "hoan_tat", "huy"];
const MOC_DON: [string, string][] = [["dat", "Ngày đặt"], ["tao", "Ngày lập"], ["hen", "Hẹn về"]];

interface CotDon extends CotLuoi { w?: number; n?: boolean }
export const COT_DON: CotDon[] = [
  { key: "ma", label: "Mã đơn", coDinh: true, w: 110 },
  { key: "nha", label: "Nhà gia công", w: 200 },
  { key: "lenh", label: "Lệnh", w: 130 },
  { key: "khach", label: "Khách hàng", w: 170 },
  { key: "viec", label: "Việc", w: 200 },
  { key: "sl", label: "Số đặt", n: true, w: 110 },
  { key: "tt", label: "Trạng thái", w: 150 },
  { key: "ngay_dat", label: "Ngày đặt", w: 100 },
  { key: "hen", label: "Hẹn về", w: 100 },
  { key: "tien", label: "Tạm tính", n: true, w: 130 },
  { key: "ngay", label: "Ngày tạo", w: 104 },
];

type Loc = { nha?: string };

function ODon({ cot, d }: { cot: string; d: TgcDon }) {
  const dong = d.dong.filter((x) => x.huy_luc == null || d.trang_thai === "huy");
  switch (cot) {
    case "ma":
      return <td>{d.ma}</td>;
    case "nha":
      return <td title={d.nha_cung_cap_ten}>{d.nha_cung_cap_ten}</td>;
    case "lenh":
      return (
        <td title={d.lenh.map((l) => l.lsx_ma).join("\n")}>
          {d.lenh[0]?.lsx_ma ?? "—"}
          {d.lenh.length > 1 && <span className="tgc-u">{`và ${d.lenh.length - 1} lệnh khác`}</span>}
        </td>
      );
    case "khach":
      return (
        <td title={d.lenh.map((l) => l.khach_hang).join("\n")}>
          {d.lenh[0]?.khach_hang || <span className="lds-mu3">—</span>}
          {d.lenh[0]?.mat_hang && <span className="tgc-u">{d.lenh[0].mat_hang}</span>}
        </td>
      );
    case "viec":
      return (
        <td title={dong.map((x) => x.ten_viec).join("\n")}>
          {dong[0]?.ten_viec ?? "—"}
          {dong.length > 1 && <span className="tgc-u">{`và ${dong.length - 1} việc khác`}</span>}
        </td>
      );
    case "sl": {
      const dv = new Set(dong.map((x) => x.don_vi ?? ""));
      return dv.size === 1 ? (
        <td className="n">{so(dong.reduce((s, x) => s + x.sl_dat, 0))}<span className="lds-u">{nhanChang(dong[0]?.don_vi)}</span></td>
      ) : (
        <td className="n">{dong.map((x) => <span key={x.id} className="tgc-u">{so(x.sl_dat)} {nhanChang(x.don_vi)}</span>)}</td>
      );
    }
    case "tt":
      return <td><ChipTT mau={MAU_TRANG_THAI_DON[d.trang_thai]}>{NHAN_TRANG_THAI_DON[d.trang_thai]}</ChipTT></td>;
    case "ngay_dat":
      return <td>{ngayDayDu(d.ngay_dat)}</td>;
    case "hen":
      return <td>{d.ngay_hen_ve ? ngayDayDu(d.ngay_hen_ve) : <span className="lds-mu3">—</span>}</td>;
    case "tien":
      return <td className="n">{tien(d.tong_tien_dat)}</td>;
    case "ngay":
      return <td className="lds-mu" title={ngayGioDayDu(d.created_at)}>{ngayDayDu(d.created_at)}</td>;
    default:
      return <td />;
  }
}

export function DonTab({
  eventTick,
  tick,
  dangMo,
  onMo,
  onDanhSach,
}: {
  eventTick?: number;
  /** Màn cha tăng số này khi vừa lập / sửa đơn — nạp lại. */
  tick?: number;
  dangMo?: number | null;
  onMo: (donId: number) => void;
  /** Báo màn cha thứ tự đơn đang hiện để ngăn đơn đi ↑ ↓. */
  onDanhSach?: (ids: number[]) => void;
}) {
  const { token } = useAuth();
  const luoi = useCauHinhLuoi("tgc-don");
  const cotHien = luoi.rongHien(luoi.xep(COT_DON).filter((c) => !luoi.an.has(c.key)));
  const [tim, setTim] = useState("");
  const timCham = useDebounced(tim.trim());
  const [nhanh, setNhanh] = useState<Nhanh>("tat_ca");
  const [ky, setKy] = useState<KyDS>({ loai: "tat_ca", moc: "dat" });
  const [loc, setLoc] = useState<Loc>({});
  const [trang, setTrang] = useState(1);
  const [coTrang, setCoTrang] = useState(25);
  const [data, setData] = useState<TgcDonListOut | null>(null);
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
    tgcApi.dsDon(token, {
      page: trang, size: coTrang, q: timCham || undefined, trang_thai: nhanh === "tat_ca" ? undefined : nhanh,
      nha_cung_cap_id: loc.nha ? Number(loc.nha) : undefined, ...thamSoKy(ky),
    })
      .then((r) => { if (alive) { setData(r); setLoi(null); onDanhSach?.(r.items.map((x) => x.id)); } })
      .catch((e) => { if (alive) setLoi(e instanceof ApiError ? e.message : "Không tải được đơn gia công."); })
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
  const tong = Object.values(facets).reduce((s, n) => s + (n ?? 0), 0);

  return (
    <section aria-label="Đơn gia công">
      <section className="lds-loc">
        <LocNhanhTrangThai
          muc={NHANH.map((k) => ({
            key: k,
            label: k === "tat_ca" ? "Tất cả" : NHAN_TRANG_THAI_DON[k],
            mau: k === "tat_ca" ? undefined : MAU_TRANG_THAI_DON[k],
            count: k === "tat_ca" ? (data ? tong : undefined) : facets[k],
          }))}
          dang={nhanh}
          onChon={(k) => setNhanh(k as Nhanh)}
          ariaLabel="Lọc đơn theo trạng thái"
        />
        <div className="lds-loc__thanh tl-thanh" role="search">
          <OTim value={tim} onChange={setTim} placeholder="Tìm mã đơn, nhà gia công, mã lệnh, việc…" ariaLabel="Tìm đơn gia công" />
          <ThanhLoc ky={ky} moc={MOC_DON} onKy={setKy} dieuKien={dieuKien} loc={loc} onLoc={setLoc} />
          <span className="kcsb-gian" />
          <ChonCot cot={COT_DON} {...luoi.chonCot} />
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
                      ? "Không có đơn nào khớp điều kiện đang lọc."
                      : "Chưa có đơn gia công nào. Lập đơn ở tab Hàng chờ: tick các việc rồi bấm Tạo đơn gia công."}
                  </td>
                </tr>
              ) : (
                data.items.map((d) => (
                  <tr key={d.id} className={`lds-dong lds-dong--bam${dangMo === d.id ? " is-mo" : ""}`}
                    tabIndex={0} onClick={() => onMo(d.id)}
                    onKeyDown={(e) => { if (e.key === "Enter") onMo(d.id); }}>
                    {cotHien.map((c) => <ODon key={c.key} cot={c.key} d={d} />)}
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
          loading={loading} donVi="đơn" ariaLabel="Phân trang đơn gia công" />
      )}
    </section>
  );
}
