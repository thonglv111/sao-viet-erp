// Tab "Hàng chờ" của màn Thuê gia công (spec 2026-11-13 §4.1): mỗi việc thuê gia công CHƯA đặt là
// một dòng, kèm đủ thông tin lệnh (mã, khách, đơn hàng, mặt hàng, hạn giao). Tình trạng: Sẵn sàng giao
// (tổ bước trước đã bàn giao) · Chờ bước trước · Chưa đặt (trọn gói). Tick nhiều dòng để gộp vào một
// đơn cùng nhà gia công. Tìm, lọc, cắt trang ở MÁY CHỦ.
import { useEffect, useState } from "react";
import { ApiError } from "../../api/client";
import { tgcApi, type TgcHangChoDong, type TgcHangChoOut, type TgcTinhTrangHangCho } from "../../api/thueGiaCong";
import { useAuth } from "../../auth/useAuth";
import { Button } from "../../components/Button";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { EmptyRow } from "../../components/EmptyState";
import {
  ChipTT, ChonCot, CuonLuoi, LocNhanhTrangThai, OTim, rongLuoi, useCauHinhLuoi, type CotLuoi,
} from "../../components/LuoiDs";
import { PhanTrangDayDu } from "../../components/PhanTrangDayDu";
import { useDebounced } from "../../utils/useDebounced";
import { ngayDayDu, ngayGioDayDu } from "../loc-san-xuat/ngay";
import { nhanChang, nhanDonVi } from "../lsxBuoc";
import { MAU_TINH_TRANG, NHAN_TINH_TRANG, so } from "./tgc";

type Nhanh = "tat_ca" | TgcTinhTrangHangCho;
const NHANH: Nhanh[] = ["tat_ca", "san_sang_giao", "cho_buoc_truoc", "chua_dat"];

interface CotHc extends CotLuoi { w?: number; n?: boolean }
export const COT_HANG_CHO: CotHc[] = [
  { key: "chon", label: "Chọn", coDinh: true, w: 40 },
  { key: "lenh", label: "Lệnh", coDinh: true, w: 130 },
  { key: "khach", label: "Khách hàng", w: 170 },
  { key: "don", label: "Đơn hàng", w: 110 },
  { key: "mat_hang", label: "Mặt hàng", w: 200 },
  { key: "han", label: "Hạn giao", w: 100 },
  { key: "viec", label: "Việc", w: 180 },
  { key: "kieu", label: "Kiểu", w: 96 },
  { key: "sl", label: "Số lượng", n: true, w: 120 },
  { key: "vat_tu", label: "Vật tư xưởng cấp", w: 180 },
  { key: "tt", label: "Tình trạng", w: 170 },
  { key: "ngay", label: "Ngày tạo", w: 104 },
  { key: "nut", label: "Thao tác", coDinh: true, w: 110 },
];

const NHAN_KIEU = (v: TgcHangChoDong) => (v.bai_ghep_id != null ? "Bài ghép" : v.kieu === "tron_goi" ? "Trọn gói" : "Một phần");

function OHangCho({ cot, v, chon, onTick, onTach }: {
  cot: string;
  v: TgcHangChoDong;
  chon: boolean;
  onTick?: () => void;
  onTach?: () => void;
}) {
  const nhieu = v.lenh.length > 1;
  switch (cot) {
    case "chon":
      return (
        <td className="kt-gop-tick">
          <input type="checkbox" aria-label={`Chọn việc ${v.ten_viec} ${v.lenh[0]?.lsx_ma ?? ""}`}
            checked={chon} onChange={onTick} />
        </td>
      );
    case "lenh":
      return (
        <td title={v.lenh.map((l) => l.lsx_ma).join("\n")}>
          {v.bai_ghep_ma ?? v.lenh[0]?.lsx_ma ?? "—"}
          {v.bai_ghep_ma && v.lenh.map((l) => <span key={l.lsx_id} className="tgc-u">{l.lsx_ma}</span>)}
        </td>
      );
    case "khach":
      return (
        <td title={v.lenh.map((l) => l.khach_hang).join("\n")}>
          {v.lenh[0]?.khach_hang || <span className="lds-mu3">—</span>}
          {nhieu && v.lenh.slice(1).map((l) => <span key={l.lsx_id} className="tgc-u">{l.khach_hang}</span>)}
        </td>
      );
    case "don":
      return (
        <td>
          {v.lenh[0]?.don_hang_ma || <span className="lds-mu3">—</span>}
          {nhieu && v.lenh.slice(1).map((l) => <span key={l.lsx_id} className="tgc-u">{l.don_hang_ma}</span>)}
        </td>
      );
    case "mat_hang":
      return (
        <td title={v.lenh.map((l) => l.mat_hang).join("\n")}>
          {v.lenh[0]?.mat_hang || <span className="lds-mu3">—</span>}
          {nhieu && v.lenh.slice(1).map((l) => <span key={l.lsx_id} className="tgc-u">{l.mat_hang}</span>)}
        </td>
      );
    case "han":
      return (
        <td>
          {ngayDayDu(v.lenh[0]?.han_giao)}
          {nhieu && v.lenh.slice(1).map((l) => <span key={l.lsx_id} className="tgc-u">{ngayDayDu(l.han_giao)}</span>)}
        </td>
      );
    case "viec":
      return (
        <td title={v.ten_viec}>
          {v.ten_viec}
          {v.so_buoc > 1 && <span className="tgc-u">{v.so_buoc} bước liền nhau</span>}
        </td>
      );
    case "kieu":
      return <td><span className="lds-tag">{NHAN_KIEU(v)}</span></td>;
    case "sl":
      return (
        <td className="n">
          {v.sl_can != null ? so(v.sl_can) : <span className="lds-mu3">—</span>}
          <span className="lds-u">{nhanChang(v.don_vi)}</span>
        </td>
      );
    case "vat_tu":
      return v.vat_tu_xuong_cap.length > 0 ? (
        <td title={v.vat_tu_xuong_cap.map((x) => `${x.ten} ${so(x.so_luong)} ${x.don_vi ?? ""}`).join("\n")}>
          {v.vat_tu_xuong_cap.map((x, i) => (
            <span key={i} className={i === 0 ? undefined : "tgc-u"}>
              {x.ten} {so(x.so_luong)} {nhanDonVi(x.don_vi)}
            </span>
          ))}
        </td>
      ) : v.kieu === "tron_goi" && v.xuong_cap_giay ? (
        <td>Giấy<span className="tgc-u">chọn khổ lúc giao</span></td>
      ) : (
        <td className="lds-mu3">Không</td>
      );
    case "tt":
      return (
        <td>
          <ChipTT mau={MAU_TINH_TRANG[v.tinh_trang]}>{NHAN_TINH_TRANG[v.tinh_trang]}</ChipTT>
          {v.tinh_trang === "san_sang_giao" && v.sl_san_sang > 0 && (
            <span className="tgc-u">{so(v.sl_san_sang)} {nhanChang(v.don_vi_giao)} đã bàn giao</span>
          )}
        </td>
      );
    case "ngay":
      return <td className="lds-mu" title={ngayGioDayDu(v.created_at)}>{ngayDayDu(v.created_at)}</td>;
    case "nut":
      return (
        <td className="tgc-o-nut">
          {onTach && v.so_buoc > 1 && (
            <button type="button" className="btn btn--ghost" onClick={onTach}
              title="Mỗi bước thành một việc riêng, đặt được cho nhà gia công khác nhau">
              Tách theo bước
            </button>
          )}
        </td>
      );
    default:
      return <td />;
  }
}

export function HangChoTab({
  eventTick,
  canTach,
  onTaoDon,
}: {
  eventTick?: number;
  canTach: boolean;
  /** Mở hộp lập đơn với các việc đã tick; `boChon` gọi khi lập xong. Không truyền = không có quyền
   *  lập đơn ⇒ không có ô tick. */
  onTaoDon?: (viecs: TgcHangChoDong[], boChon: () => void) => void;
}) {
  const { token } = useAuth();
  const luoi = useCauHinhLuoi("tgc-hang-cho");
  const goc = COT_HANG_CHO.filter((c) => c.key !== "chon" || !!onTaoDon);
  const cotHien = luoi.rongHien(luoi.xep(goc).filter((c) => !luoi.an.has(c.key)));
  const [tim, setTim] = useState("");
  const timCham = useDebounced(tim.trim());
  const [nhanh, setNhanh] = useState<Nhanh>("tat_ca");
  const [trang, setTrang] = useState(1);
  const [coTrang, setCoTrang] = useState(25);
  const [data, setData] = useState<TgcHangChoOut | null>(null);
  const [loading, setLoading] = useState(true);
  const [loi, setLoi] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  // Việc đã tick — giữ cả bản ghi để đổi trang không mất lựa chọn.
  const [chon, setChon] = useState<Map<number, TgcHangChoDong>>(new Map());
  const [tach, setTach] = useState<TgcHangChoDong | null>(null);
  const [tachBusy, setTachBusy] = useState(false);
  const [tachLoi, setTachLoi] = useState<string | null>(null);

  useEffect(() => { setTrang(1); }, [timCham, nhanh]);
  useEffect(() => {
    if (!token) return;
    let alive = true;
    setLoading(true);
    tgcApi.hangCho(token, { page: trang, size: coTrang, q: timCham || undefined, tinh_trang: nhanh === "tat_ca" ? undefined : nhanh })
      .then((r) => {
        if (!alive) return;
        setData(r);
        setLoi(null);
      })
      .catch((e) => { if (alive) setLoi(e instanceof ApiError ? e.message : "Không tải được hàng chờ."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [token, trang, coTrang, timCham, nhanh, tick, eventTick]);

  // Việc đã được đặt ở máy khác mà vẫn còn trong lựa chọn: máy chủ chặn lúc lập đơn, câu lỗi nêu việc.
  const tickViec = (v: TgcHangChoDong) =>
    setChon((cu) => {
      const moi = new Map(cu);
      if (moi.has(v.viec_id)) moi.delete(v.viec_id);
      else moi.set(v.viec_id, v);
      return moi;
    });

  async function xacNhanTach() {
    if (!token || !tach) return;
    setTachBusy(true);
    setTachLoi(null);
    try {
      await tgcApi.tachTheoBuoc(token, tach.viec_id, tach.version);
      setChon((cu) => { const m = new Map(cu); m.delete(tach.viec_id); return m; });
      setTach(null);
      setTick((k) => k + 1);
    } catch (e) {
      setTachLoi(e instanceof ApiError ? e.message : String(e));
    } finally {
      setTachBusy(false);
    }
  }

  const facets = data?.facets ?? {};
  const tong = (["san_sang_giao", "cho_buoc_truoc", "chua_dat"] as TgcTinhTrangHangCho[])
    .reduce((s, k) => s + (facets[k] ?? 0), 0);
  const daChon = [...chon.values()];

  return (
    <section aria-label="Hàng chờ gia công">
      <section className="lds-loc">
        <LocNhanhTrangThai
          muc={NHANH.map((k) => ({
            key: k,
            label: k === "tat_ca" ? "Tất cả" : NHAN_TINH_TRANG[k],
            mau: k === "tat_ca" ? undefined : MAU_TINH_TRANG[k],
            count: k === "tat_ca" ? (data ? tong : undefined) : facets[k],
          }))}
          dang={nhanh}
          onChon={(k) => setNhanh(k as Nhanh)}
          ariaLabel="Lọc hàng chờ theo tình trạng"
        />
        {/* Đang tick chọn: hàng công cụ nhường chỗ cho thao tác trên các việc đã chọn (khuôn Khách
            hàng) — cùng chiều cao nên lưới không bị đẩy. */}
        {onTaoDon && daChon.length > 0 ? (
          <div className="lds-loc__thanh lds-loc__chon" role="region" aria-label="Việc đã chọn">
            <span>{`Đã chọn ${daChon.length} việc`}</span>
            <Button variant="accent" onClick={() => onTaoDon(daChon, () => setChon(new Map()))}>
              Tạo đơn gia công
            </Button>
            <button type="button" className="lds-btn" onClick={() => setChon(new Map())}>Bỏ chọn</button>
          </div>
        ) : (
          <div className="lds-loc__thanh tl-thanh" role="search">
            <OTim value={tim} onChange={setTim} placeholder="Tìm mã lệnh, khách hàng, mặt hàng, việc…" ariaLabel="Tìm trong hàng chờ" />
            <span className="kcsb-gian" />
            <ChonCot cot={goc} {...luoi.chonCot} />
          </div>
        )}
      </section>

      <div className="lds-sheet">
        <CuonLuoi ghim={luoi.soGhim(cotHien)}>
          <table className="lds-g" style={{ minWidth: rongLuoi(cotHien) }}>
            <colgroup>
              {cotHien.map((c) => <col key={c.key} style={c.w ? { width: c.w } : undefined} />)}
            </colgroup>
            <thead>
              <tr>
                {cotHien.map((c) => (
                  <th key={c.key} className={c.n ? "n" : undefined}
                    aria-label={c.key === "chon" ? "Chọn" : c.key === "nut" ? "Thao tác" : undefined}>
                    {c.key === "chon" || c.key === "nut" ? null : c.label}
                    {luoi.keo(c.key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loi ? (
                <tr>
                  <td colSpan={cotHien.length} className="lds-trong">
                    <span className="lds-do">{loi}</span>{" "}
                    <button type="button" className="lds-lk" onClick={() => setTick((k) => k + 1)}>Thử lại</button>
                  </td>
                </tr>
              ) : data == null ? (
                <EmptyRow colSpan={cotHien.length} trangThai="dang-tai" />
              ) : data.items.length === 0 ? (
                <tr>
                  <td colSpan={cotHien.length} className="lds-trong">
                    {timCham || nhanh !== "tat_ca"
                      ? "Không có việc nào khớp điều kiện đang lọc."
                      : "Không còn việc thuê gia công nào chờ đặt. Việc tự vào đây khi lệnh có bước Thuê ngoài được phát hành, hoặc khi đặt trọn gói."}
                  </td>
                </tr>
              ) : (
                data.items.map((v) => (
                  <tr key={v.viec_id} className={`lds-dong${chon.has(v.viec_id) ? " is-chon" : ""}`}>
                    {cotHien.map((c) => (
                      <OHangCho key={c.key} cot={c.key} v={v} chon={chon.has(v.viec_id)}
                        onTick={() => tickViec(v)}
                        onTach={canTach ? () => { setTachLoi(null); setTach(v); } : undefined} />
                    ))}
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
          loading={loading} donVi="việc" ariaLabel="Phân trang hàng chờ" />
      )}

      <ConfirmDialog
        open={tach != null}
        title={`Tách “${tach?.ten_viec ?? ""}” theo bước?`}
        message="Mỗi bước thành một việc riêng trong Hàng chờ, đặt được cho nhà gia công khác nhau. Tách xong không gộp lại được."
        confirmLabel="Tách theo bước"
        busy={tachBusy}
        error={tachLoi}
        onConfirm={xacNhanTach}
        onCancel={() => setTach(null)}
      />
    </section>
  );
}
