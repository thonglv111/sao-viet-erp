// Tab "Hàng đang ở ngoài" (spec 2026-11-13 §4.6): sổ số lượng nhà gia công đang giữ, không phải kho.
// Mỗi dòng là một nhà gia công × một món (bán thành phẩm của dòng đơn, hoặc vật tư kho đã xuất thực).
// Dòng đơn hoàn tất thì rụng. Tìm, lọc, cắt trang ở MÁY CHỦ; bấm dòng mở đơn.
import { useEffect, useMemo, useState } from "react";
import { Building2 } from "lucide-react";
import { ApiError } from "../../api/client";
import { tgcApi, type TgcHangONgoai, type TgcHangONgoaiListOut, type TgcNhaGiaCong } from "../../api/thueGiaCong";
import { useAuth } from "../../auth/useAuth";
import { EmptyRow } from "../../components/EmptyState";
import { ChipTT, ChonCot, CuonLuoi, OTim, rongLuoi, useCauHinhLuoi, type CotLuoi } from "../../components/LuoiDs";
import { PhanTrangDayDu } from "../../components/PhanTrangDayDu";
import { useDebounced } from "../../utils/useDebounced";
import { ngayDayDu } from "../loc-san-xuat/ngay";
import { nhanChang, nhanDonVi } from "../lsxBuoc";
import { ThanhLoc } from "../thanh-loc/ThanhLoc";
import type { DieuKien } from "../thanh-loc/thanh-loc";
import { so } from "./tgc";

interface CotHn extends CotLuoi { w?: number; n?: boolean }
export const COT_HN: CotHn[] = [
  { key: "nha", label: "Nhà gia công", coDinh: true, w: 200 },
  { key: "hang", label: "Hàng", w: 220 },
  { key: "loai", label: "Loại", w: 130 },
  { key: "don", label: "Đơn", w: 110 },
  { key: "lenh", label: "Lệnh", w: 130 },
  { key: "giao", label: "Đã giao", n: true, w: 110 },
  { key: "ve", label: "Đã về", n: true, w: 110 },
  { key: "con", label: "Còn ở ngoài", n: true, w: 130 },
  { key: "hen", label: "Hẹn về", w: 110 },
];

type Loc = { nha?: string };

/** Bán thành phẩm đếm theo mã chặng (tờ in, con…); vật tư theo đơn vị kho. */
const dvHang = (r: TgcHangONgoai) => (r.loai === "vat_tu" ? nhanDonVi(r.don_vi) : nhanChang(r.don_vi));

function OHn({ cot, r }: { cot: string; r: TgcHangONgoai }) {
  switch (cot) {
    case "nha":
      return <td title={r.nha_cung_cap_ten}>{r.nha_cung_cap_ten}</td>;
    case "hang":
      return <td title={r.ten_hang}>{r.ten_hang}{r.kho && <span className="tgc-u">Khổ {r.kho}</span>}</td>;
    case "loai":
      return <td>{r.loai === "vat_tu" ? <ChipTT mau="cyan">Vật tư kho</ChipTT> : <ChipTT mau="tim">Bán thành phẩm</ChipTT>}</td>;
    case "don":
      return <td>{r.ma_don}</td>;
    case "lenh":
      return (
        <td title={r.lenh.map((l) => l.lsx_ma).join("\n")}>
          {r.lenh[0]?.lsx_ma ?? "—"}
          {r.lenh.length > 1 && <span className="tgc-u">{`và ${r.lenh.length - 1} lệnh khác`}</span>}
        </td>
      );
    case "giao":
      return <td className="n">{so(r.giao)}<span className="lds-u">{dvHang(r)}</span></td>;
    case "ve":
      return <td className="n">{r.da_ve > 0 ? so(r.da_ve) : <span className="lds-mu3">—</span>}</td>;
    case "con":
      return <td className="n">{so(r.con_ngoai)}<span className="lds-u">{dvHang(r)}</span></td>;
    case "hen":
      return <td>{r.ngay_hen_ve ? ngayDayDu(r.ngay_hen_ve) : <span className="lds-mu3">—</span>}</td>;
    default:
      return <td />;
  }
}

export function HangONgoaiTab({ eventTick, tick, onMoDon }: {
  eventTick?: number;
  tick?: number;
  onMoDon: (donId: number) => void;
}) {
  const { token } = useAuth();
  const luoi = useCauHinhLuoi("tgc-hang-o-ngoai");
  const cotHien = luoi.rongHien(luoi.xep(COT_HN).filter((c) => !luoi.an.has(c.key)));
  const [tim, setTim] = useState("");
  const timCham = useDebounced(tim.trim());
  const [loc, setLoc] = useState<Loc>({});
  const [trang, setTrang] = useState(1);
  const [coTrang, setCoTrang] = useState(25);
  const [data, setData] = useState<TgcHangONgoaiListOut | null>(null);
  const [loading, setLoading] = useState(true);
  const [loi, setLoi] = useState<string | null>(null);
  const [thuLai, setThuLai] = useState(0);
  const [nhas, setNhas] = useState<TgcNhaGiaCong[]>([]);

  useEffect(() => {
    if (token) tgcApi.nhaGiaCong(token, true).then(setNhas).catch(() => setNhas([]));
  }, [token]);
  useEffect(() => { setTrang(1); }, [timCham, loc]);
  useEffect(() => {
    if (!token) return;
    let alive = true;
    setLoading(true);
    tgcApi.hangONgoai(token, {
      page: trang, size: coTrang, q: timCham || undefined, nha_cung_cap_id: loc.nha ? Number(loc.nha) : undefined,
    })
      .then((r) => { if (alive) { setData(r); setLoi(null); } })
      .catch((e) => { if (alive) setLoi(e instanceof ApiError ? e.message : "Không tải được hàng đang ở ngoài."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [token, trang, coTrang, timCham, loc, thuLai, tick, eventTick]);

  const dieuKien: DieuKien<Loc>[] = useMemo(() => [{
    khoa: "nha", nhan: "Nhà gia công", icon: Building2, kieu: "mot", tim: true,
    giaTri: nhas.map((n) => ({ value: String(n.id), nhan: n.ten })),
    doc: (l) => l.nha, ghi: (l, v) => ({ ...l, nha: v }),
  }], [nhas]);

  return (
    <section aria-label="Hàng đang ở ngoài">
      <section className="lds-loc">
        <div className="lds-loc__thanh tl-thanh" role="search">
          <OTim value={tim} onChange={setTim} placeholder="Tìm nhà gia công, mã đơn, mã lệnh, tên hàng…" ariaLabel="Tìm hàng đang ở ngoài" />
          <ThanhLoc dieuKien={dieuKien} loc={loc} onLoc={setLoc} />
          <span className="kcsb-gian" />
          <ChonCot cot={COT_HN} {...luoi.chonCot} />
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
                    {timCham || loc.nha ? "Không có hàng nào khớp điều kiện đang lọc." : "Không có hàng nào đang ở nhà gia công."}
                  </td>
                </tr>
              ) : (
                data.items.map((r) => (
                  <tr key={`${r.don_dong_id}-${r.loai}-${r.ten_hang}-${r.kho ?? ""}`} className="lds-dong lds-dong--bam"
                    tabIndex={0} onClick={() => onMoDon(r.don_id)}
                    onKeyDown={(e) => { if (e.key === "Enter") onMoDon(r.don_id); }}>
                    {cotHien.map((c) => <OHn key={c.key} cot={c.key} r={r} />)}
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
          loading={loading} donVi="dòng" ariaLabel="Phân trang hàng đang ở ngoài" />
      )}
    </section>
  );
}
