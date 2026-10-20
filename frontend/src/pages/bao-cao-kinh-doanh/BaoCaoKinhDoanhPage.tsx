// BÁO CÁO KINH DOANH theo khách hàng (24/09/2026).
//
// Trả lời: trong kỳ, mỗi khách đặt những đơn nào, đơn gồm sản phẩm gì, đơn giá bao nhiêu, cọc phải
// thu / đã nhận bao nhiêu. Chủ chốt: chỉ ĐƠN ĐÃ CHỐT, vào kỳ theo NGÀY CHỐT, phạm vi theo ô quyền
// riêng `bao_cao_kinh_doanh` (sale chỉ thấy đơn mình bán — server lọc, màn này không lọc thêm).
//
// Thanh lọc chung (06/10/2026): kỳ theo NGÀY CHỐT (mặc định Tháng này), mọi điều kiện lọc ở MÁY CHỦ.
// Xuất Excel gửi đúng bộ lọc đang áp nên file = bảng đang xem.
//
// 11/10/2026 làm lại theo khuôn lưới của Bàn tổ › Sản lượng: một khối đầu bảng [Tìm] [Kỳ] [Lọc] … [Cột],
// lưới kéo được độ rộng, ẩn / đổi chỗ / ghim cột. Ô gộp dọc (khách, đơn) giữ nguyên để đọc một khách
// liền một khối; dòng "Tổng có VAT" dưới mỗi đơn thành cột (dòng trải ngang không đi theo cột khi người
// xem đổi chỗ / ẩn cột), dòng Cộng của khách đặt số đúng dưới cột của nó.
//
// Phương án C (11/10/2026, mockup docs/mockups/bao-cao-kinh-doanh-3-phuong-an.html): Bảng thêm phần
// thực hiện đơn (đã giao, còn phải giao, đã xuất HĐ, đã thu, còn phải thu, hẹn giao — lũy kế tới cuối
// kỳ), dòng Tổng cộng cuối bảng và dải ghi chú "đầu báo cáo"; bỏ dải số tổng (Tổng cộng đã nói). Thêm
// cách xem Biểu đồ. Tỷ lệ báo giá ẩn mặc định, Đơn hàng ghim mặc định.
//
// 12/10/2026 dạng Biểu đồ làm lại theo phương án A (`BieuDoKinhDoanh`): bấm khách → Bảng lọc khách đó,
// bấm một cột thời gian → Bảng với kỳ đúng khoảng đó, bấm một đơn → Bảng tô các dòng của đơn.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  ApiError,
  api,
  type BaoCaoKinhDoanh,
  type BaoCaoKinhDoanhDon,
  type BaoCaoKinhDoanhKhach,
  type BaoCaoKinhDoanhTien,
} from "../../api/client";
import { useAuth } from "../../auth/useAuth";
import { Button } from "../../components/Button";
import { EmptyRow } from "../../components/EmptyState";
import { Icon } from "../../components/Icons";
import { ChonCot, CuonLuoi, OTim, rongLuoi, useCauHinhLuoi, type CotLuoi } from "../../components/LuoiDs";
import { fmtDate, fmtDateISO, fmtDateTime, money } from "../../utils/format";
import { useDebounced } from "../../utils/useDebounced";
import { ThanhLoc } from "../thanh-loc/ThanhLoc";
import { thamSoKy } from "../thanh-loc/ky-danh-sach";
import { soDaAp } from "../thanh-loc/thanh-loc";
import { useLocMan } from "../thanh-loc/useLocMan";
import {
  LOC_MAN_BCKD_TRONG,
  MOC_BCKD,
  locManBCKDLenUrl,
  locManBCKDTuUrl,
  thamSoLocBCKD,
  useDieuKienBCKD,
} from "./dieu-kien-bao-cao-kinh-doanh";
import { BieuDoKinhDoanh } from "./BieuDoKinhDoanh";
import "./bao-cao-kinh-doanh.css";

type Cot = CotLuoi & { w?: number; n?: boolean };

const COT: Cot[] = [
  { key: "khach", label: "Khách hàng", coDinh: true, w: 220 },
  { key: "don", label: "Đơn hàng", w: 130 },
  { key: "sale", label: "Sale", w: 150 },
  { key: "mh", label: "Mặt hàng", w: 240 },
  { key: "sl", label: "SL đặt", w: 90, n: true },
  { key: "dvt", label: "ĐVT", w: 70 },
  { key: "giao", label: "Đã giao", w: 90, n: true },
  { key: "cgiao", label: "Còn phải giao", w: 110, n: true },
  { key: "dg", label: "Đơn giá", w: 110, n: true },
  { key: "tt", label: "Thành tiền", w: 130, n: true },
  { key: "vat", label: "Tổng có VAT", w: 140, n: true },
  { key: "hd", label: "Đã xuất HĐ", w: 130, n: true },
  { key: "thu", label: "Đã thu", w: 130, n: true },
  // Tiền trả lại khách ngoài đơn cộng nợ lại vào hoá đơn của đơn (#47) — cùng luật Công nợ phải thu.
  { key: "hk", label: "Trả lại ngoài đơn", w: 130, n: true },
  { key: "cthu", label: "Còn phải thu", w: 130, n: true },
  { key: "hen", label: "Hẹn giao", w: 110 },
  { key: "coc", label: "Cọc", w: 150 },
  { key: "tl", label: "Tỷ lệ báo giá", w: 110, n: true },
];

/** Khoá cấu hình lưới của màn. Đổi khoá ở phương án C vì bộ cột đổi hẳn — cấu hình cũ (ẩn / thứ tự)
 *  của bộ cột trước không còn nghĩa. */
const MAN = "bao-cao-kinh-doanh-c";

/** Mặc định của người xem chưa chỉnh lần nào: ẩn Tỷ lệ báo giá, ghim Đơn hàng (Khách hàng là cột cố
 *  định). Ghi vào chỗ `useCauHinhLuoi` đọc TRƯỚC khi hook đọc; người xem đã chỉnh thì không đụng. */
function datMacDinhLuoi() {
  try {
    if (localStorage.getItem(`lds-cot-an:${MAN}`) == null) localStorage.setItem(`lds-cot-an:${MAN}`, JSON.stringify(["tl"]));
    if (localStorage.getItem(`lds-cot-ghim:${MAN}`) == null) localStorage.setItem(`lds-cot-ghim:${MAN}`, JSON.stringify(["don"]));
  } catch {
    /* trình duyệt chặn lưu thì dùng mặc định chung */
  }
}

type CachXem = "bang" | "bieu-do";
const KHOA_XEM = "bckd-cach-xem";

function docCachXem(): CachXem {
  try {
    return localStorage.getItem(KHOA_XEM) === "bieu-do" ? "bieu-do" : "bang";
  } catch {
    return "bang";
  }
}

const so = (v: number) => v.toLocaleString("vi-VN");

const PHAM_VI: Record<string, string> = {
  all: "toàn công ty",
  department: "khách của phòng bạn",
  own: "khách bạn phụ trách",
};

function kyChu(tu: string | null, den: string | null): string {
  if (tu && den) return `từ ${fmtDateISO(tu)} đến ${fmtDateISO(den)}`;
  if (tu) return `từ ${fmtDateISO(tu)}`;
  if (den) return `đến ${fmtDateISO(den)}`;
  return "mọi thời gian";
}

const Khong = ({ children = "—" }: { children?: ReactNode }) => <span className="bckd__khong">{children}</span>;

function Tien({ v }: { v: number | null | undefined }) {
  return v ? <>{money(v)}</> : <Khong />;
}

/** Tiền mà 0 vẫn là một con số (chưa thu, chưa xuất hoá đơn) — hiện "0 đ" mờ thay vì "—". */
function TienKhong({ v }: { v: number }) {
  return v ? <>{money(v)}</> : <Khong>{money(0)}</Khong>;
}

/** Ô của cột ghim đứng yên khi cuộn ngang. Lưới có ô gộp dọc nên luật ghim theo thứ tự ô của
 *  `luoi-ds.css` (nth-child) đếm sai ở dòng thứ hai trở đi — ô tự mang vị trí trái của cột mình
 *  (biến `--lds-gN` do `CuonLuoi` đo; cột không vừa nửa khung thì biến vắng, ô không ghim). */
function ghimO(i: number, soGhim: number): { className?: string; style?: CSSProperties } {
  return i < soGhim ? { className: "bckd__ghim", style: { "--lds-trai": `var(--lds-g${i + 1})` } as CSSProperties } : {};
}

/** Cọc gọn còn "% cọc" + còn thiếu: tiền cọc đã nhận nằm trong cột Đã thu. */
function OCoc({ d }: { d: BaoCaoKinhDoanhDon }) {
  if (!d.coc_pct && !d.coc_da_nhan) return <Khong>Không cọc</Khong>;
  return (
    <>
      <span>{d.coc_pct ? `${d.coc_pct.toLocaleString("vi-VN")}%` : "Có cọc"}</span>
      {d.coc_con_thieu > 0 ? (
        <span className="bckd__thieu" title={`Phải thu ${money(d.coc_phai_thu)}, đã nhận ${money(d.coc_da_nhan)}`}>
          Còn thiếu {money(d.coc_con_thieu)}
        </span>
      ) : (
        <span className="bckd__dong-phu">Đủ cọc</span>
      )}
    </>
  );
}

/** Số tiền của đơn / dòng Cộng / Tổng cộng theo khoá cột; cột không có số cộng thì `undefined`. */
function tienCot(key: string, m: BaoCaoKinhDoanhTien): number | undefined {
  switch (key) {
    case "tt": return m.tong;
    case "vat": return m.tong_vat;
    case "hd": return m.da_xuat_hd;
    case "thu": return m.da_thu;
    case "hk": return m.hoan_khong_don;
    case "cthu": return m.con_phai_thu;
    default: return undefined;
  }
}

/** Một khách = một khối dòng: ô Khách gộp dọc cả khối, ô Đơn / Sale / tiền của đơn / Hẹn giao / Cọc gộp
 *  dọc cả đơn, mỗi mặt hàng một dòng; cuối khối là dòng Cộng. */
function KhoiKhach({ k, cot, soGhim, hl }: { k: BaoCaoKinhDoanhKhach; cot: Cot[]; soGhim: number; hl: number | null }) {
  const soDong = (d: BaoCaoKinhDoanhDon) => Math.max(1, d.dong.length);
  const soDongKhach = k.don.reduce((s, d) => s + soDong(d), 0);
  return (
    <tbody className="bckd__khoi">
      {k.don.flatMap((d, di) => {
        const dong = d.dong.length ? d.dong : [null];
        return dong.map((ln, li) => {
          const dauDon = li === 0;
          const o = (c: Cot, i: number) => {
            const g = ghimO(i, soGhim);
            const gop = { ...g, rowSpan: soDong(d) };
            const so_ = `n ${g.className ?? ""}`;
            switch (c.key) {
              case "khach":
                return di === 0 && dauDon && (
                  <td key={c.key} {...g} rowSpan={soDongKhach} className={`bckd__nhieu-dong ${g.className ?? ""}`} title={k.ten}>
                    {k.ten}
                  </td>
                );
              case "don":
                return dauDon && (
                  <td key={c.key} {...gop} className={`bckd__nhieu-dong ${g.className ?? ""}`}>
                    <span>{d.order_no}</span>
                    <span className="bckd__dong-phu">{fmtDate(d.ngay_chot)}</span>
                    {d.po_khach && <span className="bckd__dong-phu" title="Số PO của khách">{d.po_khach}</span>}
                  </td>
                );
              case "sale":
                return dauDon && <td key={c.key} {...gop} className={`bckd__nhieu-dong ${g.className ?? ""}`}>{d.sale ?? <Khong />}</td>;
              case "tl":
                return dauDon && (
                  <td key={c.key} {...gop} className={so_}>
                    {d.ty_le_bao_gia == null ? <Khong /> : `${d.ty_le_bao_gia}%`}
                  </td>
                );
              case "mh":
                return (
                  <td key={c.key} {...g} title={ln?.ten || undefined}>
                    {ln ? ln.ten || <Khong /> : <Khong>Không có mặt hàng</Khong>}
                  </td>
                );
              case "sl":
                return <td key={c.key} {...g} className={so_}>{ln ? so(ln.so_luong) : ""}</td>;
              case "dvt":
                return <td key={c.key} {...g}>{ln?.dvt ?? ""}</td>;
              case "giao":
                return <td key={c.key} {...g} className={so_}>{ln && (ln.da_giao ? so(ln.da_giao) : <Khong>0</Khong>)}</td>;
              case "cgiao":
                return <td key={c.key} {...g} className={so_}>{ln && (ln.con_giao ? so(ln.con_giao) : <Khong>0</Khong>)}</td>;
              case "dg":
                return <td key={c.key} {...g} className={so_}>{ln && <Tien v={ln.don_gia} />}</td>;
              case "tt":
                return <td key={c.key} {...g} className={so_}>{ln && <Tien v={ln.thanh_tien} />}</td>;
              case "vat":
              case "hd":
              case "thu":
              case "hk":
              case "cthu":
                return dauDon && <td key={c.key} {...gop} className={so_}><TienKhong v={tienCot(c.key, d) ?? 0} /></td>;
              case "hen":
                return dauDon && <td key={c.key} {...gop}>{d.ngay_giao ? fmtDate(d.ngay_giao) : <Khong />}</td>;
              case "coc":
                return dauDon && (
                  <td key={c.key} {...gop} className={`bckd__nhieu-dong ${g.className ?? ""}`}><OCoc d={d} /></td>
                );
              default:
                return null;
            }
          };
          return (
            <tr key={`${d.order_id}-${li}`} className={d.order_id === hl ? "bckd-hl" : undefined}>
              {cot.map(o)}
            </tr>
          );
        });
      })}
      <tr className="lds-cong bckd__cong">
        {cot.map((c, i) => {
          const g = ghimO(i, soGhim);
          if (i === 0) return <td key={c.key} {...g}>Cộng {k.so_don} đơn</td>;
          const v = tienCot(c.key, k);
          if (v !== undefined) {
            return (
              <td key={c.key} {...g} className={`n ${g.className ?? ""}`} title={c.key === "tt" ? "Cộng thành tiền chưa VAT" : undefined}>
                <TienKhong v={v} />
              </td>
            );
          }
          if (c.key === "coc" && k.coc_con_thieu > 0) {
            return <td key={c.key} {...g}><span className="bckd__thieu">Còn thiếu {money(k.coc_con_thieu)}</span></td>;
          }
          return <td key={c.key} {...g} />;
        })}
      </tr>
    </tbody>
  );
}

/** Dòng Tổng cộng cuối bảng — cùng chỗ đặt số với dòng Cộng của từng khách. */
function DongTongCong({ bc, cot, soGhim }: { bc: BaoCaoKinhDoanh; cot: Cot[]; soGhim: number }) {
  const t = bc.tong;
  return (
    <tfoot>
      <tr className="lds-cong bckd__tong">
        {cot.map((c, i) => {
          const g = ghimO(i, soGhim);
          if (i === 0) return <td key={c.key} {...g}>Tổng cộng {t.so_don} đơn</td>;
          if (i === 1) return <td key={c.key} {...g}>{t.so_khach} khách</td>;
          const v = tienCot(c.key, t);
          if (v !== undefined) return <td key={c.key} {...g} className={`n ${g.className ?? ""}`}><TienKhong v={v} /></td>;
          if (c.key === "coc" && t.coc_con_thieu > 0) {
            return <td key={c.key} {...g}><span className="bckd__thieu">Còn thiếu {money(t.coc_con_thieu)}</span></td>;
          }
          return <td key={c.key} {...g} />;
        })}
      </tr>
    </tfoot>
  );
}

export function BaoCaoKinhDoanhPage() {
  const { token } = useAuth();
  const [locMan, setLocMan] = useLocMan("bao-cao-kinh-doanh", LOC_MAN_BCKD_TRONG, locManBCKDTuUrl, locManBCKDLenUrl);
  const { ky, loc } = locMan;
  const [tim, setTim] = useState("");
  const timTre = useDebounced(tim.trim());
  const [data, setData] = useState<BaoCaoKinhDoanh | null>(null);
  const [lapLuc, setLapLuc] = useState<string | null>(null);
  const [xem, setXem] = useState<CachXem>(docCachXem);
  /** Đơn được bấm ở dạng biểu đồ — tô ở dạng bảng. */
  const [hl, setHl] = useState<number | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const dieuKien = useDieuKienBCKD(data?.lua_chon);
  const thamSo = useMemo(
    () => ({ ...thamSoKy(ky), ...thamSoLocBCKD(loc), q: timTre || undefined }),
    [ky, loc, timTre],
  );
  const khoaThamSo = JSON.stringify(thamSo);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dangXuat, setDangXuat] = useState(false);
  datMacDinhLuoi();
  const luoi = useCauHinhLuoi(MAN);
  const cot = luoi.rongHien(luoi.xep(COT).filter((c) => !luoi.an.has(c.key)));
  const soGhim = luoi.soGhim(cot);

  const tai = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      setData(await api.baoCaoKinhDoanh.xem(token, JSON.parse(khoaThamSo)));
      setLapLuc(new Date().toISOString());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Không tải được báo cáo.");
    } finally {
      setLoading(false);
    }
  }, [token, khoaThamSo]);

  useEffect(() => {
    void tai();
  }, [tai]);

  const khachHien = data?.khach ?? [];
  const coLoc = !!timTre || soDaAp(dieuKien, loc) > 0;
  const trong = coLoc ? "Không có đơn đã chốt nào khớp điều kiện đang lọc." : "Không có đơn đã chốt nào trong kỳ này.";

  // Đơn vừa bấm ở biểu đồ: cuộn tới dòng đầu của đơn khi bảng đã vẽ.
  useEffect(() => {
    if (xem !== "bang" || hl == null || !data) return;
    sheetRef.current?.querySelector("tr.bckd-hl")?.scrollIntoView({ block: "center" });
  }, [xem, hl, data]);

  function doiXem(v: CachXem) {
    setXem(v);
    if (v === "bieu-do") setHl(null);
    try {
      localStorage.setItem(KHOA_XEM, v);
    } catch {
      /* không nhớ được thì thôi */
    }
  }

  async function xuatExcel() {
    if (!token) return;
    setDangXuat(true);
    try {
      const { url, ten } = await api.baoCaoKinhDoanh.xuatExcel(token, thamSo);
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
      setDangXuat(false);
    }
  }

  return (
    <main className="bckd lds">
      <header className="lds-dau">
        <h1 className="lds-dau__ten">Báo cáo kinh doanh</h1>
        <div className="lds-dau__nut">
          <Button variant="ghost" onClick={() => void xuatExcel()} disabled={dangXuat || !data || khachHien.length === 0}>
            <Icon name="table" size={14} />{" "}
            {dangXuat ? "Đang xuất…" : loc.khach == null ? "Xuất Excel" : "Xuất Excel khách này"}
          </Button>
        </div>
      </header>

      {error && <div className="banner banner--error" role="alert">{error}</div>}

      {/* Một khối đầu bảng như Bàn tổ › Sản lượng: [Tìm] [Kỳ ▾] [Lọc] … [Bảng | Biểu đồ] [Cột]. */}
      <section className="lds-loc">
        <div className="lds-loc__thanh tl-thanh" role="search">
          <OTim value={tim} onChange={setTim} placeholder="Tìm số đơn, PO, khách, mặt hàng…" ariaLabel="Tìm trong báo cáo" />
          <ThanhLoc
            ky={ky}
            moc={MOC_BCKD}
            onKy={(k) => setLocMan({ ky: k, loc })}
            dieuKien={dieuKien}
            loc={loc}
            onLoc={(l) => setLocMan({ ky, loc: l })}
          />
          <div className="bckd-sg bckd__xem" role="group" aria-label="Cách xem">
            <button type="button" aria-pressed={xem === "bang"} onClick={() => doiXem("bang")}>Bảng</button>
            <button type="button" aria-pressed={xem === "bieu-do"} onClick={() => doiXem("bieu-do")}>Biểu đồ</button>
          </div>
          {xem === "bang" && <ChonCot cot={COT} {...luoi.chonCot} />}
        </div>
        {data && (
          <div className="bckd__ghi" aria-label="Thông tin báo cáo">
            <span>Kỳ <b>{kyChu(data.tu_ngay, data.den_ngay)}</b></span>
            <span>Đơn đã chốt, vào kỳ theo <b>ngày chốt</b></span>
            <span>Phạm vi <b>{PHAM_VI[data.pham_vi] ?? data.pham_vi}</b></span>
            <span>Giao, hoá đơn, thu tính tới <b>{fmtDate(data.tinh_toi)}</b></span>
            {lapLuc && <span>Lập lúc <b>{fmtDateTime(lapLuc)}</b></span>}
          </div>
        )}
      </section>

      {xem === "bieu-do" ? (
        data && khachHien.length > 0 ? (
          <BieuDoKinhDoanh
            bc={data}
            onKhach={(id) => {
              setLocMan({ ky, loc: { ...loc, khach: id } });
              doiXem("bang");
            }}
            onKy={(tu, den) => {
              setLocMan({ ky: { loai: "tuy", tu, den, moc: ky.moc }, loc });
              doiXem("bang");
            }}
            onDon={(id) => {
              doiXem("bang");
              setHl(id);
            }}
          />
        ) : (
          <div className="lds-sheet"><p className="lds-trong bckd__trong">{loading ? "Đang tải…" : trong}</p></div>
        )
      ) : (
        <div className="lds-sheet" ref={sheetRef}>
          <CuonLuoi ghim={soGhim}>
            <table className="lds-g bckd__luoi" style={{ minWidth: rongLuoi(cot, 200) }}>
              <colgroup>
                {cot.map((c) => <col key={c.key} style={c.w ? { width: c.w } : undefined} />)}
              </colgroup>
              <thead>
                <tr>
                  {cot.map((c) => (
                    <th key={c.key} className={c.n ? "n" : undefined}>
                      {c.label}
                      {luoi.keo(c.key)}
                    </th>
                  ))}
                </tr>
              </thead>
              {loading && !data ? (
                <tbody><EmptyRow colSpan={cot.length} trangThai="dang-tai" /></tbody>
              ) : khachHien.length === 0 || !data ? (
                <tbody>
                  <tr>
                    <td colSpan={cot.length} className="lds-trong">{trong}</td>
                  </tr>
                </tbody>
              ) : (
                <>
                  {khachHien.map((k) => <KhoiKhach key={k.customer_id ?? "khong-gan"} k={k} cot={cot} soGhim={soGhim} hl={hl} />)}
                  <DongTongCong bc={data} cot={cot} soGhim={soGhim} />
                </>
              )}
            </table>
          </CuonLuoi>
          {khachHien.length > 0 && (
            <p className="bckd__chu-thich">
              Tổng có VAT, Đã xuất HĐ, Đã thu cùng công thức với màn Đơn hàng bán và Công nợ phải thu. Đã thu gồm cả tiền cọc.
              Trả lại ngoài đơn là tiền trả lại khách không gắn đơn, cộng nợ lại vào hoá đơn hạn muộn nhất của khách như Công nợ phải thu.
              Hoá đơn và phiếu thu đã huỷ không tính.
            </p>
          )}
        </div>
      )}
    </main>
  );
}
