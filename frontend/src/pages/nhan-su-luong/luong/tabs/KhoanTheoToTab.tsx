// Lương → Khoán theo tổ (22/10/2026) — mockup đã duyệt `docs/mockups/khoan-theo-to-a-chi-tiet.html`.
// Quỹ tổ → Chia cho người → Sổ sản lượng → Hỏng máy → Người của tổ làm ở tổ khác. CHỈ XEM: số do máy
// chủ tính (`services/khoan_theo_to.py`), màn này chỉ bày và cộng dòng.
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { Calendar } from "lucide-react";
import {
  api,
  type KhoanTheoTo,
  type KttLanGhi,
  type KttNguoi,
  type KttNguoiLan,
  type SxSlQuyCach,
} from "../../../../api/client";
import { CongThucTip } from "../../../../components/CongThucTip";
import { EmptyState } from "../../../../components/EmptyState";
import { HoverTip } from "../../../../components/HoverTip";
import { ChipTT } from "../../../../components/LuoiDs";
import { MonthPicker } from "../../../../components/MonthPicker";
import { curYm, errText, money } from "../shared/helpers";
import "./khoan-theo-to.css";

const THU = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

/** "2026-10-05" → "T2 05/10". */
export function nhanNgay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${THU[new Date(y, m - 1, d).getDay()]} ${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}`;
}

/** Phần trăm kiểu Việt, một chữ số lẻ: 36.42 → "36,4%". */
function pt(x: number): string {
  return `${(Math.round(x * 10) / 10).toLocaleString("vi-VN")}%`;
}

/** Sổ ghi tên ngắn (hai chữ cuối) như sổ Excel của tổ. */
function tenNgan(ten: string): string {
  return ten.trim().split(/\s+/).slice(-2).join(" ");
}

function cm(mm: number): string {
  return (Math.round(mm) / 10).toLocaleString("vi-VN", { maximumFractionDigits: 1 });
}

/** Bong bóng nhiều dòng "nhãn viên thuốc — nội dung". */
function Hov({ neo, rows, tieuDe, rong = 440 }: { neo: ReactNode; rows: [string, ReactNode][]; tieuDe?: string; rong?: number }) {
  return (
    <HoverTip tieuDe={tieuDe} rong={rong} lopNeo="ktt-neo" neo={neo}>
      <dl className="hover-tip__dong">
        {rows.map(([k, v]) => (
          <div className="hover-tip__hang" key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </HoverTip>
  );
}

function QuyCach({ qc }: { qc: SxSlQuyCach | null }) {
  if (!qc) return <span className="ktt-trong">Chưa có quy cách</span>;
  const giay = Array.isArray(qc.giay) ? qc.giay : qc.giay ? [qc.giay] : [];
  const kho: [string, SxSlQuyCach["con"]][] = [["Tờ nguyên", qc.to_nguyen], ["Tờ in", qc.to_in], ["Con", qc.con]];
  return (
    <div className="ktt-qc">
      <div className="ktt-qc__giay">
        {giay.length ? giay.map((g) => <span key={g}>{g}</span>) : <span>Chưa khai giấy</span>}
        {qc.dinh_luong ? <span className="ktt-sub">{qc.dinh_luong} gsm</span> : null}
      </div>
      <dl>
        {kho.map(([nhan, k]) => (
          <div key={nhan}>
            <dt>{nhan}</dt>
            <dd>{k ? `${cm(k.dai)} × ${cm(k.rong)}` : "—"}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Tên người trong sổ; người không thuộc tổ đang xem ghi tổ của họ sau tên. */
function TenNguoi({ n }: { n: { ten: string; to_ten: string | null } }) {
  return (
    <span>
      {tenNgan(n.ten)}
      {n.to_ten && <span className="ktt-sub"> {n.to_ten}</span>}
    </span>
  );
}

/** Người tham gia một lần ghi: tên | % (rê ra cách chia) | tiền; dòng tổ trưởng chia/thưởng cuối. */
function NguoiLan({ lan }: { lan: KttLanGhi }) {
  const bo = lan.he_so === 0;
  const goc = lan.tien * (lan.he_so || 1);
  const ptTt = lan.to_truong.filter((t) => t.che_do === "chia").reduce((s, t) => s + t.ty_le, 0);
  const conLai = 100 - ptTt;
  const tongW = lan.nguoi.reduce((s, n) => s + n.luong_bu_lo, 0);
  return (
    <ul className="ktt-ng">
      {lan.nguoi.map((n) => {
        const cach = tongW > 0 ? (n.luong_bu_lo / tongW) * 100 : 0;
        const phan = (conLai * cach) / 100;
        const tien = bo ? Math.round((goc * phan) / 100) : n.tien;
        const khac = lan.nguoi.filter((x) => x.emp_id !== n.emp_id).map((x) => money(x.luong_bu_lo));
        const rows: [string, ReactNode][] = [];
        if (ptTt > 0) rows.push(["Còn lại", `100% − ${pt(ptTt)} tổ trưởng chia = ${pt(conLai)}`]);
        rows.push(["Cách chia", lan.nguoi.length === 1
          ? "làm một mình, ăn trọn phần chia của lần ghi"
          : `lương bù lỗ ${money(n.luong_bu_lo)} ÷ (${[money(n.luong_bu_lo), ...khac].join(" + ")}) = ${pt(cach)}`]);
        if (ptTt > 0) rows.push(["Phần người", `${pt(conLai)} × ${pt(cach)} = ${pt(phan)}`]);
        rows.push(["Tiền", `${money(goc)} × ${pt(phan)} = ${money(tien)}`]);
        return (
          <li key={n.emp_id}>
            <TenNguoi n={n} />
            <span className="ktt-pt"><Hov neo={pt(phan)} rows={rows} rong={460} /></span>
            <span className={bo ? "ktt-gach" : ""}>{money(tien)}</span>
          </li>
        );
      })}
      {lan.to_truong.map((t, i) => {
        const chia = t.che_do === "chia";
        return (
          <li key={`tt${i}`} className="ktt-ng__tt">
            <span>{chia ? "Tổ trưởng chia" : "Tổ trưởng thưởng"}</span>
            <span className="ktt-pt">
              <Hov neo={pt(t.ty_le)} rong={440} rows={[
                ["Thế số", `${money(goc)} × ${pt(t.ty_le)} = ${money(t.tien)}`],
                ["Người nhận", `${t.ten} dù có làm lần này hay không`],
                ["Nguồn", chia ? "trích trước khi chia cho người làm" : "công ty trả thêm, không trừ ai"],
              ]} />
            </span>
            <span className={bo ? "ktt-gach" : ""}>{money(t.tien)}</span>
          </li>
        );
      })}
    </ul>
  );
}

function TienLan({ lan }: { lan: KttLanGhi }) {
  const bo = lan.he_so === 0;
  const hien = lan.tien * (lan.he_so || 1);
  const ps = lan.phat_sinh.map((p) => `+ ${p.ten ?? "phát sinh"} ${money(p.so_luong)} × ${money(p.don_gia)} = ${money(p.tien)}`);
  if (lan.he_so === 2) ps.push(`× 2 = ${money(hien)}`);
  return (
    <CongThucTip congThuc={lan.cong_thuc} tieuDe={lan.cong_doan} them={ps.join("  ") || null} ghiChu={lan.ghi_chu}>
      <span className={`ktt-tien${bo ? " ktt-gach" : ""}`}>{money(hien)}</span>
    </CongThucTip>
  );
}

const khoaLenh = (l: KttLanGhi) => `${l.nguon_loai}:${l.nguon_id ?? `b${l.batch_id}`}`;

/** Sổ theo ngày, trong ngày gộp ô Lệnh/Khách/Quy cách theo lệnh (như bảng Sản lượng của tổ). */
function BangSo({ ds, nhanNgayPhu, nhanTong }: {
  ds: KttLanGhi[];
  nhanNgayPhu: (ngay: string, dong: KttLanGhi[]) => ReactNode;
  nhanTong: string;
}) {
  const theoNgay = useMemo(() => {
    const m = new Map<string, KttLanGhi[]>();
    for (const l of ds) m.set(l.ngay, [...(m.get(l.ngay) ?? []), l]);
    return [...m.entries()];
  }, [ds]);
  return (
    <div className="ktt-cuon">
      <table className="ktt-g ktt-so">
        <colgroup>
          <col style={{ width: 140 }} /><col style={{ width: 110 }} /><col style={{ width: 190 }} />
          <col style={{ width: 150 }} /><col style={{ width: 130 }} /><col style={{ width: 110 }} />
          <col style={{ width: 76 }} /><col style={{ width: 96 }} /><col />
        </colgroup>
        <thead>
          <tr>
            <th>Lệnh sản xuất</th><th>Khách hàng</th><th>Giấy và quy cách (cm)</th><th>Công đoạn</th>
            <th>Tuỳ chọn</th><th>Việc phát sinh</th><th className="r">Số lượng</th><th className="r">Tiền</th>
            <th>Người tham gia</th>
          </tr>
        </thead>
        {theoNgay.map(([ngay, dong]) => {
          const tong = dong.reduce((s, l) => s + l.tien * l.he_so, 0);
          // Gộp ô theo lệnh liền nhau trong ngày.
          const span = dong.map((l, i) => {
            if (i > 0 && khoaLenh(dong[i - 1]) === khoaLenh(l)) return 0;
            let n = 1;
            while (i + n < dong.length && khoaLenh(dong[i + n]) === khoaLenh(l)) n++;
            return n;
          });
          return (
            <Fragment key={ngay}>
              <tbody className="ktt-so__ngay">
                <tr>
                  <td colSpan={6}><span className="ktt-so__d">{nhanNgay(ngay)}</span>{nhanNgayPhu(ngay, dong)}</td>
                  <td className="r ktt-sub">{nhanTong}</td>
                  <td className="r">{money(tong)}</td>
                  <td />
                </tr>
              </tbody>
              <tbody>
                {dong.map((l, i) => (
                  <tr key={l.batch_id}>
                    {span[i] > 0 && (
                      <>
                        <td rowSpan={span[i]}>
                          <div>{l.lenh_ma || "—"}</div>
                          {l.lenh_ten && <div className="ktt-sub">{l.lenh_ten}</div>}
                        </td>
                        <td rowSpan={span[i]}>{l.khach ?? <span className="ktt-trong">—</span>}</td>
                        <td rowSpan={span[i]}><QuyCach qc={l.quy_cach} /></td>
                      </>
                    )}
                    <td>
                      {l.cong_doan}
                      {l.bac && <div className="ktt-sub">{l.bac}</div>}
                      {l.ghi_chu && <div className="ktt-sub">{l.ghi_chu}</div>}
                    </td>
                    <td>
                      {l.tuy_chon.length
                        ? <div className="ktt-the">{l.tuy_chon.map((t) => <ChipTT key={t} mau="cyan" vuong>{t}</ChipTT>)}</div>
                        : null}
                    </td>
                    <td>
                      {l.phat_sinh.length ? l.phat_sinh.map((p, j) => (
                        <div className="ktt-ps" key={j}>
                          <span>{p.ten}</span>
                          <span className="ktt-sub">{money(p.so_luong)}{p.don_vi ? ` ${p.don_vi}` : ""}</span>
                        </div>
                      )) : <span className="ktt-trong">—</span>}
                    </td>
                    <td className="r">{l.so_luong.toLocaleString("vi-VN")}</td>
                    <td className="r"><TienLan lan={l} /></td>
                    <td><NguoiLan lan={l} /></td>
                  </tr>
                ))}
              </tbody>
            </Fragment>
          );
        })}
      </table>
    </div>
  );
}

type CotChia = "san_luong" | "dung_may" | "tang_ca" | "to_truong" | "o_to_khac";

function BangChia({ data }: { data: KhoanTheoTo }) {
  const tt = data.to_truong;
  const cot: [CotChia, string][] = ([
    ["san_luong", "Sản lượng"],
    ["dung_may", "Dừng máy"],
    ["tang_ca", "Tăng ca khoán"],
    ["to_truong", tt?.che_do === "thuong" ? "Tổ trưởng thưởng" : "Tổ trưởng chia"],
    ["o_to_khac", "Ở tổ khác"],
  ] as [CotChia, string][]).filter(([k]) => k === "san_luong" || data.nguoi.some((n) => n[k] !== 0));
  const soLanTt = data.so.filter((l) => l.to_truong.length && l.he_so > 0).length;
  const tong = (f: (n: KttNguoi) => number | null) => data.nguoi.reduce((s, n) => s + (f(n) ?? 0), 0);
  const khoanTra = (n: KttNguoi) => (n.thu_viec || n.cong_nhat ? 0 : n.luong_khoan);

  function oCot(n: KttNguoi, k: CotChia) {
    const v = n[k];
    if (!v) return "";
    // Người ăn công nhật không nhận tăng ca khoán — số vẫn bày ra để thấy phần của họ trong quỹ.
    if (k === "tang_ca" && n.cong_nhat) return <span className="ktt-gach">{money(v)}</span>;
    if (k === "to_truong" && tt) {
      return <Hov neo={<span className="ktt-tien">{money(v)}</span>} rong={400} rows={[
        ["Thế số", `cộng ${pt(tt.ty_le)} của ${soLanTt} lần ghi trong sổ = ${money(v)}`],
        ["Nguồn", tt.che_do === "chia" ? "trích trước khi chia" : "công ty trả thêm, không trừ ai"],
      ]} />;
    }
    return money(v);
  }

  return (
    <div className="ktt-cuon">
      <table className="ktt-g ktt-chia">
        <thead>
          <tr>
            <th>Người</th>
            {cot.map(([k, ten]) => <th key={k} className="r">{ten}</th>)}
            <th className="r ktt-ke">Lương khoán</th>
            <th className="r">Phân bổ lương bù lỗ</th>
            <th className="r">Chênh lệch</th>
            <th className="r ktt-ke">Lương chính</th>
          </tr>
        </thead>
        <tbody>
          {data.nguoi.map((n) => {
            const khoan = khoanTra(n);
            const lopKhoan = n.an === "khoan" ? "ktt-thang" : n.an === "bu_lo" ? "ktt-thua" : "";
            const lopBuLo = n.an === "bu_lo" ? "ktt-thang" : n.an === "khoan" ? "ktt-thua" : "";
            const gom: [string, ReactNode][] = cot
              .filter(([k]) => k !== "tang_ca" && n[k] !== 0)
              .map(([k, ten]) => [ten, money(n[k])]);
            gom.push(["Cộng", money(n.luong_khoan)]);
            if (n.thu_viec) gom.push(["Thử việc", "khoán về 0, chỉ ăn phân bổ lương bù lỗ"]);
            if (n.cong_nhat) gom.push(["Công nhật", "không hưởng tiền khoán, phần này không dồn cho ai"]);
            const lech = khoan != null && n.phan_bo_bu_lo != null ? khoan - n.phan_bo_bu_lo : null;
            return (
              <tr key={n.emp_id}>
                <td>
                  <div className="ktt-ten">
                    {n.ten}
                    {n.to_ten && <span className="ktt-sub">{n.to_ten}</span>}
                    {tt && tt.emp_id === n.emp_id && <ChipTT mau="slate">tổ trưởng</ChipTT>}
                    {n.thu_viec && <ChipTT mau="vang">thử việc</ChipTT>}
                    {n.cong_nhat && <ChipTT mau="tim">ăn công nhật</ChipTT>}
                  </div>
                  <div className="ktt-sub">lương bù lỗ {money(n.luong_bu_lo)}</div>
                </td>
                {cot.map(([k]) => <td key={k} className="r">{oCot(n, k)}</td>)}
                {!n.la_thanh_vien ? (
                  <td colSpan={4} className="ktt-ke ktt-sub">lương chính tính ở tổ của họ</td>
                ) : n.cong_nhat ? (
                  <>
                    <td className="r ktt-ke">
                      <Hov neo={<span className="ktt-tien">0</span>} rows={gom} rong={380} />
                      <div className="ktt-sub">công nhật về 0</div>
                    </td>
                    <td colSpan={3} className="ktt-ke ktt-sub">lương theo công và tăng ca giờ ở bảng lương</td>
                  </>
                ) : (
                  <>
                    <td className={`r ktt-ke ${lopKhoan}`}>
                      <Hov neo={<span className="ktt-tien">{money(khoan)}</span>} rows={gom} rong={380} />
                      {n.thu_viec && <div className="ktt-sub">thử việc về 0</div>}
                    </td>
                    <td className={`r ${lopBuLo}`}>
                      {n.phan_bo_bu_lo == null ? <span className="ktt-trong">—</span> : (
                        <>
                          <Hov neo={<span className="ktt-tien">{money(n.phan_bo_bu_lo)}</span>} rong={380} rows={[
                            ["Thế số", `lương bù lỗ ${money(n.luong_bu_lo)} ÷ ${n.chuan_cong ?? 26} × ${n.cong ?? "?"} công = ${money(n.phan_bo_bu_lo)}`],
                          ]} />
                          {n.cong != null && <div className="ktt-sub">{n.cong.toLocaleString("vi-VN")} công</div>}
                        </>
                      )}
                    </td>
                    <td className={`r ${lech == null ? "" : lech >= 0 ? "ktt-duong" : "ktt-am"}`}>
                      {lech == null ? "" : `${lech >= 0 ? "+" : "−"}${money(Math.abs(lech))}`}
                    </td>
                    <td className="r ktt-ke">{n.luong_chinh == null ? <span className="ktt-trong">—</span> : money(n.luong_chinh)}</td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td>Cộng</td>
            {cot.map(([k]) => <td key={k} className="r">{money(tong((n) => n[k]))}</td>)}
            <td className="r ktt-ke">{money(tong((n) => (n.la_thanh_vien ? khoanTra(n) : 0)))}</td>
            <td className="r">{money(tong((n) => (n.cong_nhat ? 0 : n.phan_bo_bu_lo)))}</td>
            <td />
            <td className="r ktt-ke">{money(tong((n) => (n.cong_nhat ? 0 : n.luong_chinh)))}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function DoiChieu({ dc }: { dc: NonNullable<KhoanTheoTo["doi_chieu"]> }) {
  const buoc: [string, string, number][] = [["", "Quỹ tổ", dc.quy]];
  if (dc.tang_ca) buoc.push(["−", "tăng ca khoán trả riêng", dc.tang_ca]);
  if (dc.to_truong_thuong) buoc.push(["+", "tổ trưởng thưởng công ty trả", dc.to_truong_thuong]);
  if (dc.thu_viec) buoc.push(["−", "phần thử việc không hưởng", dc.thu_viec]);
  if (dc.cong_nhat) buoc.push(["−", "phần công nhật không hưởng", dc.cong_nhat]);
  if (dc.nguoi_to_khac) buoc.push(["−", "phần người tổ khác", dc.nguoi_to_khac]);
  if (dc.o_to_khac) buoc.push(["+", "làm ở tổ khác", dc.o_to_khac]);
  buoc.push(["=", "lương khoán trả", dc.luong_khoan]);
  if (dc.bu_lo != null && dc.luong_chinh != null) {
    buoc.push(["+", "công ty bù lỗ", dc.bu_lo], ["=", "lương chính cả tổ", dc.luong_chinh]);
  }
  return (
    <div className="ktt-tom ktt-doi">
      {buoc.map(([dau, nhan, so]) => (
        <Fragment key={nhan}>
          {dau && <div className="ktt-tom__dau">{dau}</div>}
          <div><div className="ktt-sub">{nhan}</div><div>{money(so)}</div></div>
        </Fragment>
      ))}
    </div>
  );
}

function NguoiDm({ tien, ds }: { tien: number; ds: KttNguoiLan[] }) {
  const tongW = ds.reduce((s, n) => s + n.luong_bu_lo, 0);
  return (
    <ul className="ktt-ng">
      {ds.map((n) => {
        const cach = tongW > 0 ? (n.luong_bu_lo / tongW) * 100 : 0;
        const khac = ds.filter((x) => x.emp_id !== n.emp_id).map((x) => money(x.luong_bu_lo));
        return (
          <li key={n.emp_id}>
            <TenNguoi n={n} />
            <span className="ktt-pt">
              <Hov neo={pt(cach)} rong={460} rows={[
                ["Cách chia", ds.length === 1 ? "một người hưởng trọn"
                  : `lương bù lỗ ${money(n.luong_bu_lo)} ÷ (${[money(n.luong_bu_lo), ...khac].join(" + ")}) = ${pt(cach)}`],
                ["Tiền", `${money(tien)} × ${pt(cach)} = ${money(n.tien)}`],
              ]} />
            </span>
            <span>{money(n.tien)}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function KhoanTheoToTab({ token }: { token: string }) {
  const [ym, setYm] = useState(curYm);
  const [toId, setToId] = useState<number | null>(null);
  const [data, setData] = useState<KhoanTheoTo | null>(null);
  const [loi, setLoi] = useState<string | null>(null);
  const [year, month] = ym.split("-").map(Number);

  useEffect(() => {
    let huy = false;
    setLoi(null);
    setData(null);
    api.luong
      .khoanTheoTo(token, year, month, toId)
      .then((r) => !huy && setData(r))
      .catch((e: unknown) => !huy && setLoi(errText(e)));
    return () => {
      huy = true;
    };
  }, [token, year, month, toId]);

  const ngay = useMemo(() => new Map((data?.ngay ?? []).map((d) => [d.ngay, d])), [data]);
  const ky = `${String(month).padStart(2, "0")}/${year}`;
  const tt = data?.to_truong;

  return (
    <div className="ktt">
      <div className="cc-toolbar lg-toolbar">
        <div className="lg-toolbar-filters tl-thanh">
          <div className="lg-date-wrapper">
            <span className="lg-date-icon"><Calendar size={14} /></span>
            <MonthPicker value={ym} onChange={setYm} ariaLabel="Kỳ lương" />
          </div>
          <label className="ktt-chon">
            <span className="ktt-sub">Tổ</span>
            <select
              aria-label="Tổ"
              value={data?.to_id ?? toId ?? ""}
              onChange={(e) => setToId(e.target.value ? Number(e.target.value) : null)}
              disabled={!data?.cac_to.length}
            >
              {!data?.cac_to.length && <option value="">Chưa có tổ nào</option>}
              {data?.cac_to.map((t) => <option key={t.id} value={t.id}>{t.ten}</option>)}
            </select>
          </label>
        </div>
      </div>

      {loi && <div className="banner banner--error">{loi}</div>}
      {data == null && !loi && <EmptyState trangThai="dang-tai" inline nhanTai="Đang tải khoán theo tổ…" />}
      {data != null && data.to_id == null && (
        <EmptyState title="Kỳ này chưa có lần ghi sản lượng nào ra tiền khoán"
          sub="Tổ ghi sản lượng ở bàn tổ, tiền khoán hiện ở đây theo kỳ." />
      )}

      {data != null && data.to_id != null && data.quy && (
        <div className="ktt-pad">
          <div className="ktt-tom">
            <div><div className="ktt-sub">Quỹ tổ tháng {ky}</div><div className="ktt-tom__lon">{money(data.quy.tong)}</div></div>
            <div className="ktt-tom__dau">=</div>
            <div><div className="ktt-sub">Sản lượng</div><div>{money(data.quy.san_luong)}</div></div>
            {data.quy.dung_may !== 0 && (<><div className="ktt-tom__dau">+</div>
              <div><div className="ktt-sub">Dừng máy</div><div>{money(data.quy.dung_may)}</div></div></>)}
            {data.quy.tang_ca !== 0 && (<><div className="ktt-tom__dau">+</div>
              <div><div className="ktt-sub">Tăng ca khoán</div><div>{money(data.quy.tang_ca)}</div></div></>)}
          </div>
          {tt && (
            <div className="ktt-dai">
              <ChipTT mau={tt.che_do === "chia" ? "xanh" : "la"}>
                {tt.che_do === "chia" ? "Tổ trưởng ăn chia" : "Tổ trưởng ăn thưởng"} {pt(tt.ty_le)}
              </ChipTT>
              <span>
                {tt.che_do === "chia"
                  ? `Lần ghi nào cũng trích ${pt(tt.ty_le)} cho ${tt.ten} trước khi chia, dù tổ trưởng có làm lần đó hay không.`
                  : `Lần ghi nào công ty cũng trả thêm ${pt(tt.ty_le)} cho ${tt.ten}, không trừ của ai trong tổ.`}
                {" "}Cả kỳ {money(tt.tien)}.
              </span>
            </div>
          )}
          {!data.co_bang_luong && (
            <div className="banner banner--info">
              Kỳ {ky} chưa tạo bảng lương nên chưa có phân bổ lương bù lỗ và lương chính. Tạo ở tab Bảng lương tháng.
            </div>
          )}

          <h3>Chia cho người</h3>
          <p className="ktt-hint">
            Mỗi lần ghi chia cho người được tick theo lương bù lỗ tháng: phần của một người = lương bù lỗ của họ ÷
            tổng lương bù lỗ những người cùng được tick. Cả tháng so lương khoán với phân bổ lương bù lỗ, ăn bên
            cao hơn. Lương khoán không gồm tăng ca khoán: cột tăng ca để xem, bảng lương cộng sau.
          </p>
          <div className="ktt-chu">
            <span className="ktt-o ktt-thang" />bên được trả<span className="ktt-o" />bên thua. Chênh lệch = lương
            khoán − phân bổ lương bù lỗ. Rê chuột vào tiền để xem thế số.
          </div>
          <BangChia data={data} />
          {data.doi_chieu && <DoiChieu dc={data.doi_chieu} />}

          <h3>Sổ sản lượng</h3>
          <p className="ktt-hint">
            Gom theo ngày, trong ngày gộp ô theo lệnh như bảng Sản lượng của tổ. Rê chuột vào số tiền để xem công
            thức và thế số, vào % cạnh tên để xem lần ghi đó chia thế nào.
          </p>
          {data.so.length === 0 ? <p className="ktt-trong">Tổ không có lần ghi nào ra tiền trong kỳ.</p> : (
            <BangSo ds={data.so} nhanTong="Tổ làm" nhanNgayPhu={(d) => {
              const x = ngay.get(d);
              if (!x || x.chi_tieu <= 0) return null;
              return x.tang_ca > 0 ? (
                <>
                  <span className="ktt-sub">vượt chỉ tiêu {money(x.chi_tieu)}</span>
                  <ChipTT mau="la">tăng ca khoán {money(x.tang_ca)}</ChipTT>
                </>
              ) : <span className="ktt-sub">dưới chỉ tiêu {money(x.chi_tieu)}</span>;
            }} />
          )}

          {data.dung_may.length > 0 && (
            <>
              <h3>Hỏng máy, dừng máy</h3>
              <p className="ktt-hint">
                Từ hộp Báo dừng máy ở bàn tổ. Mỗi ngày dừng ăn đúng chỉ tiêu ngày của tổ, chia theo lương bù lỗ của
                người được tick.
              </p>
              <div className="ktt-cuon">
                <table className="ktt-g">
                  <thead>
                    <tr><th>Ngày</th><th>Lý do</th><th>Phiếu sửa chữa</th><th>Ghi chú</th><th className="r">Tiền</th><th>Người hưởng</th></tr>
                  </thead>
                  <tbody>
                    {data.dung_may.map((d, i) => (
                      <tr key={i}>
                        <td>{nhanNgay(d.ngay)}</td>
                        <td>{d.ly_do && <ChipTT mau="cam">{d.ly_do}</ChipTT>}</td>
                        <td>{d.sua_chua ?? <span className="ktt-trong">—</span>}</td>
                        <td>{d.ghi_chu ?? ""}</td>
                        <td className="r">{money(d.tien)}</td>
                        <td><NguoiDm tien={d.tien} ds={d.nguoi} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {data.khac.length > 0 && (
            <>
              <h3>Người của tổ làm ở tổ khác</h3>
              <p className="ktt-hint">
                Lần ghi thuộc sổ của tổ kia: tổ trưởng tổ kia trích phần của mình trước, phần còn lại chia cho mọi
                người được tick theo lương bù lỗ. Người tổ mình cộng phần của họ vào cột Ở tổ khác.
              </p>
              <BangSo ds={data.khac} nhanTong="Lần ghi" nhanNgayPhu={(_, dong) => (
                <span className="ktt-sub">{[...new Set(dong.map((l) => l.to_ten).filter(Boolean))].join(" và ")}</span>
              )} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
