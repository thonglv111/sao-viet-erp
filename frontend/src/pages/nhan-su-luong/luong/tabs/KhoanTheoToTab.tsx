// Lương → Khoán theo tổ (22/10/2026) — mockup đã duyệt `docs/mockups/khoan-theo-to-a-chi-tiet.html`.
// Quỹ tổ → Chia cho người → Sổ sản lượng → Hỏng máy → Người của tổ làm ở tổ khác. Số do máy chủ tính
// (`services/khoan_theo_to.py`), màn này chỉ bày và cộng dòng. Kế toán gõ tay được ba chỗ kiểu Excel
// (23/10/2026, `KhoanGoTay.tsx`): ô Tiền một lần ghi, dòng tay cuối sổ, cột Cộng thêm — mỗi dòng một Ghi chú.
import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Calendar } from "lucide-react";
import {
  api,
  type KhoanTheoTo,
  type KttDongTayIn,
  type KttLanGhi,
  type KttNguoi,
  type KttNguoiLan,
  type SxSlQuyCach,
} from "../../../../api/client";
import { CongThucTip } from "../../../../components/CongThucTip";
import { EmptyState } from "../../../../components/EmptyState";
import { ChipTT } from "../../../../components/LuoiDs";
import { MonthPicker } from "../../../../components/MonthPicker";
import { curYm, errText, money } from "../shared/helpers";
import { Hov, pt } from "../components/HovDong";
import { useKhiTickDoi } from "../../../../hooks/useKhiTickDoi";
import { ChonNguoi, docNgay, docSo, LuoiGoTay, OGo, type MucMenu } from "./KhoanGoTay";
import "./khoan-theo-to.css";

const THU = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

/** "2026-10-05" → "T2 05/10". */
export function nhanNgay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${THU[new Date(y, m - 1, d).getDay()]} ${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}`;
}

/** Sổ ghi tên ngắn (hai chữ cuối) như sổ Excel của tổ. */
function tenNgan(ten: string): string {
  return ten.trim().split(/\s+/).slice(-2).join(" ");
}

/** Lúc kế toán gõ: "23/10 14:05". */
function gio(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const h = (n: number) => String(n).padStart(2, "0");
  return `${h(d.getDate())}/${h(d.getMonth() + 1)} ${h(d.getHours())}:${h(d.getMinutes())}`;
}

const ai = (ten: string | null, luc: string | null) => `${ten ?? "—"}${luc ? `, ${gio(luc)}` : ""}`;

function cm(mm: number): string {
  return (Math.round(mm) / 10).toLocaleString("vi-VN", { maximumFractionDigits: 1 });
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
        // Lần ghi gạch (tổ in ngày CN / lễ): không ai được chia ⇒ không in số chia (L-SX-36).
        rows.push(["Tiền", bo ? "tổ in ngày Chủ nhật / lễ không tính sản lượng" : `${money(goc)} × ${pt(phan)} = ${money(tien)}`]);
        return (
          <li key={n.emp_id}>
            <TenNguoi n={n} />
            <span className="ktt-pt"><Hov neo={pt(phan)} rows={rows} rong={460} /></span>
            <span>{bo ? "—" : money(tien)}</span>
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
                ["Thế số", bo ? "tổ in ngày Chủ nhật / lễ không tính sản lượng" : `${money(goc)} × ${pt(t.ty_le)} = ${money(t.tien)}`],
                ["Người nhận", `${t.ten} dù có làm lần này hay không`],
                ["Nguồn", chia ? "trích trước khi chia cho người làm" : "công ty trả thêm, không trừ ai"],
              ]} />
            </span>
            <span>{bo ? "—" : money(t.tien)}</span>
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

const khoaLenh = (l: KttLanGhi) =>
  l.loai === "dong_tay" ? `tay:${l.dong_tay_id}` : `${l.nguon_loai}:${l.nguon_id ?? `b${l.batch_id}`}`;

/** Ô Tiền một lần ghi: số kế toán gõ thì kèm số máy gạch ngang, rê ra ai gõ lúc nào. Công đoạn chưa có
 *  cấu hình Khoán thì ô khoá — máy chủ không nhận tiền gõ tay cho lần ghi đó (L-SX-27). */
function OTienLan({ l, duoc }: { l: KttLanGhi; duoc: boolean }) {
  const hien = l.tien * (l.he_so || 1);
  return (
    <OGo k={`b${l.batch_id}|tien`} giaTri={money(l.tien)} tay={l.tay} lop="r" duoc={duoc && !l.khong_khoan}>
      {l.tay ? (
        <>
          <Hov neo={<span className={`ktt-tien${l.he_so === 0 ? " ktt-gach" : ""}`}>{money(hien)}</span>} rong={320} rows={[
            ["Máy tính", money(l.tien_may)],
            ["Kế toán gõ", ai(l.sua_boi, l.sua_luc)],
          ]} />
          <span className="ktt-may">{money(l.tien_may)}</span>
        </>
      ) : <TienLan lan={l} />}
    </OGo>
  );
}

/** Sổ theo ngày, trong ngày gộp ô Lệnh/Khách/Quy cách theo lệnh (như bảng Sản lượng của tổ). `coGhiChu` =
 *  sổ của tổ đang xem (có cột Ghi chú, dòng tay); `moi` = thêm dòng trống cuối sổ để gõ dòng tay. */
function BangSo({ ds, nhanNgayPhu, nhanTong, coGhiChu = false, duoc = false, moi = false }: {
  ds: KttLanGhi[];
  nhanNgayPhu: (ngay: string, dong: KttLanGhi[]) => ReactNode;
  nhanTong: string;
  coGhiChu?: boolean;
  duoc?: boolean;
  moi?: boolean;
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
          <col style={{ width: 76 }} /><col style={{ width: 110 }} /><col style={{ width: coGhiChu ? 260 : undefined }} />
          {coGhiChu && <col style={{ minWidth: 200 }} />}
        </colgroup>
        <thead>
          <tr>
            <th>Lệnh sản xuất</th><th>Khách hàng</th><th>Giấy và quy cách (cm)</th><th>Công đoạn</th>
            <th>Tuỳ chọn</th><th>Việc phát sinh</th><th className="r">Số lượng</th><th className="r">Tiền</th>
            <th>Người tham gia</th>
            {coGhiChu && <th>Ghi chú</th>}
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
                  {coGhiChu && <td />}
                </tr>
              </tbody>
              <tbody>
                {dong.map((l, i) => l.loai === "dong_tay" ? (
                  <DongTay key={`t${l.dong_tay_id}`} l={l} duoc={duoc} />
                ) : (
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
                      {(l.chua_tinh ?? []).map((x) => <div key={x}><ChipTT mau="cam">{x}</ChipTT></div>)}
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
                    {coGhiChu ? <OTienLan l={l} duoc={duoc} /> : <td className="r"><TienLan lan={l} /></td>}
                    <td><NguoiLan lan={l} /></td>
                    {coGhiChu && (
                      <OGo k={`b${l.batch_id}|gc`} giaTri={l.ghi_chu_tay ?? ""} lop="ktt-gc" duoc={duoc}>{l.ghi_chu_tay}</OGo>
                    )}
                  </tr>
                ))}
              </tbody>
            </Fragment>
          );
        })}
        {moi && (
          <tbody>
            <tr className="ktt-so__moi">
              <OGo k="moi|ngay" giaTri="" />
              <OGo k="moi|nd" giaTri="" colSpan={5}>Gõ vào dòng này để thêm một dòng tay</OGo>
              <td />
              <OGo k="moi|tien" giaTri="" lop="r" />
              <td />
              <OGo k="moi|gc" giaTri="" lop="ktt-gc" />
            </tr>
          </tbody>
        )}
      </table>
    </div>
  );
}

/** Dòng tay kế toán chèn vào sổ: ngày | nội dung | tiền | người tham gia | ghi chú, ô nào cũng gõ được. */
function DongTay({ l, duoc }: { l: KttLanGhi; duoc: boolean }) {
  const id = l.dong_tay_id;
  const dm = l.ngay.slice(8, 10) + "/" + l.ngay.slice(5, 7);
  return (
    <tr className="ktt-so__tay">
      <OGo k={`t${id}|ngay`} giaTri={dm} duoc={duoc}>{dm}<div className="ktt-sub">dòng tay</div></OGo>
      <OGo k={`t${id}|nd`} giaTri={l.noi_dung ?? ""} colSpan={5} duoc={duoc}>
        {l.noi_dung || <span className="ktt-trong">—</span>}
      </OGo>
      <td />
      <OGo k={`t${id}|tien`} giaTri={money(l.tien)} tay lop="r" duoc={duoc}>
        <Hov neo={<span className="ktt-tien">{money(l.tien)}</span>} rong={320} rows={[
          ["Kế toán thêm", ai(l.sua_boi, l.sua_luc)],
        ]} />
      </OGo>
      <OGo k={`t${id}|ng`} giaTri="" duoc={duoc}>
        {l.loi && <div className="ktt-am">{l.loi}</div>}
        <NguoiLan lan={l} />
      </OGo>
      <OGo k={`t${id}|gc`} giaTri={l.ghi_chu_tay ?? ""} lop="ktt-gc" duoc={duoc}>{l.ghi_chu_tay}</OGo>
    </tr>
  );
}

type CotChia = "san_luong" | "dung_may" | "tang_ca" | "to_truong" | "o_to_khac";

function BangChia({ data, duoc }: { data: KhoanTheoTo; duoc: boolean }) {
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
  const khoanTra = (n: KttNguoi) => (n.cong_nhat ? 0 : n.luong_khoan);

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
            <th className="r ktt-ke" style={{ width: 120 }}>Cộng thêm</th>
            <th style={{ width: 220 }}>Ghi chú</th>
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
                {/* Người đã chuyển tổ mà còn Cộng thêm gõ ở tổ này: hiện và sửa ở đây (L-SX-33). */}
                {n.la_thanh_vien || n.cong_them != null ? (
                  <>
                    <OGo k={`c${n.emp_id}|cong`} giaTri={n.cong_them == null ? "" : money(n.cong_them)}
                      tay={n.cong_them != null} lop="r ktt-ke" duoc={duoc}>
                      {n.cong_them != null && (
                        <Hov neo={<span className={`ktt-tien${n.cong_them < 0 ? " ktt-am" : ""}`}>{money(n.cong_them)}</span>}
                          rong={320} rows={[["Kế toán gõ", ai(n.cong_them_sua_boi, n.cong_them_sua_luc)]]} />
                      )}
                    </OGo>
                    <OGo k={`c${n.emp_id}|gc`} giaTri={n.cong_them_ghi_chu ?? ""} lop="ktt-gc" duoc={duoc}>
                      {n.cong_them_ghi_chu}
                    </OGo>
                  </>
                ) : (
                  <><td className="ktt-ke" /><td /></>
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
            <td className={`r ktt-ke${tong((n) => n.cong_them) < 0 ? " ktt-am" : ""}`}>
              {tong((n) => n.cong_them) !== 0 ? money(tong((n) => n.cong_them)) : ""}
            </td>
            <td />
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

export function KhoanTheoToTab({ token, eventTick = 0 }: { token: string; eventTick?: number }) {
  const [ym, setYm] = useState(curYm);
  const [toId, setToId] = useState<number | null>(null);
  const [data, setData] = useState<KhoanTheoTo | null>(null);
  const [loi, setLoi] = useState<string | null>(null);
  const [loiGo, setLoiGo] = useState<string | null>(null);
  const [nguoiMo, setNguoiMo] = useState<{ id: number; x: number; y: number; tren: number } | null>(null);
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
  const duoc = !!data?.sua_duoc;

  // ---- kế toán gõ tay: lưu một ô rồi tải lại payload (số do máy chủ tính) -------------------------
  const taiLai = useCallback(
    () => api.luong.khoanTheoTo(token, year, month, toId).then(setData),
    [token, year, month, toId],
  );
  // Kế toán khác vừa sửa tay sổ (SSE `khoan_theo_to_changed`, L-SX-37) ⇒ nạp lại; chữ đang gõ dở nằm
  // trong state của ô gõ nên không mất.
  useKhiTickDoi(eventTick, () => void taiLai().catch(() => undefined));

  const luu = useCallback(async (k: string, chu: string): Promise<string | void> => {
    if (!data || data.to_id == null) return;
    const [rk, cot] = k.split("|");
    const id = Number(rk.slice(1));
    const go = chu.trim();
    const bao = (s: string) => { setLoiGo(s); };
    const tienKhongAm = () => {
      const v = docSo(chu);
      if (v === undefined || (v != null && v < 0)) { bao("Tiền phải là số, không âm."); return undefined; }
      return v;
    };
    try {
      if (rk === "moi") {
        if (!go) return;
        const homNay = new Date();
        const body: KttDongTayIn = {
          year, month, to_id: data.to_id,
          ngay: homNay.getFullYear() === year && homNay.getMonth() + 1 === month
            ? `${ym}-${String(homNay.getDate()).padStart(2, "0")}`
            : `${ym}-${String(new Date(year, month, 0).getDate()).padStart(2, "0")}`,
          nguoi_ids: data.thanh_vien.map((t) => t.emp_id),
        };
        if (cot === "ngay") {
          const d = docNgay(chu, year, month);
          if (!d) return bao(`Ngày phải nằm trong tháng ${ky}.`);
          body.ngay = d;
        } else if (cot === "nd") body.noi_dung = go;
        else if (cot === "gc") body.ghi_chu = go;
        else if (cot === "tien") {
          const v = tienKhongAm();
          if (v === undefined) return;
          body.tien = v ?? 0;
        }
        if (!body.nguoi_ids.length) return bao("Tổ chưa có ai có lương ca máy để chia dòng tay.");
        const { id: moi } = await api.luong.themDongTayKhoan(token, body);
        await taiLai();
        setLoiGo(null);
        return `t${moi}|${cot}`;
      }
      if (rk[0] === "b") {
        const l = data.so.find((x) => x.batch_id === id);
        if (!l) return;
        if (cot === "tien") {
          const v = tienKhongAm();
          if (v === undefined) return;
          // Gõ đúng số máy = bỏ số tay.
          const tien = v == null || v === (l.tay ? l.tien_may : l.tien) ? null : v;
          if (tien === (l.tay ? l.tien : null)) return;
          await api.luong.suaLanGhiKhoan(token, id, { tien });
        } else {
          if (go === (l.ghi_chu_tay ?? "")) return;
          await api.luong.suaLanGhiKhoan(token, id, { ghi_chu: go || null });
        }
      } else if (rk[0] === "t") {
        const l = data.so.find((x) => x.dong_tay_id === id);
        if (!l) return;
        if (cot === "ngay") {
          const d = docNgay(chu, year, month);
          if (!d) return bao(`Ngày phải nằm trong tháng ${ky}.`);
          if (d === l.ngay) return;
          await api.luong.suaDongTayKhoan(token, id, { ngay: d });
        } else if (cot === "nd") {
          if (go === (l.noi_dung ?? "")) return;
          await api.luong.suaDongTayKhoan(token, id, { noi_dung: go });
        } else if (cot === "tien") {
          const v = tienKhongAm();
          if (v === undefined || (v ?? 0) === l.tien) return;
          await api.luong.suaDongTayKhoan(token, id, { tien: v ?? 0 });
        } else if (cot === "gc") {
          if (go === (l.ghi_chu_tay ?? "")) return;
          await api.luong.suaDongTayKhoan(token, id, { ghi_chu: go || null });
        }
      } else if (rk[0] === "c") {
        const n = data.nguoi.find((x) => x.emp_id === id);
        if (!n) return;
        const nen = { year, month, to_id: data.to_id, emp_id: id };
        if (cot === "cong") {
          const v = docSo(chu);
          if (v === undefined) return bao("Cộng thêm phải là số (gõ số âm để trừ).");
          const tien = v || null;
          if (tien === n.cong_them) return;
          await api.luong.suaCongThemKhoan(token, { ...nen, tien });
        } else {
          if (go === (n.cong_them_ghi_chu ?? "")) return;
          await api.luong.suaCongThemKhoan(token, { ...nen, ghi_chu: go || null });
        }
      }
      await taiLai();
      setLoiGo(null);
    } catch (e) {
      setLoiGo(errText(e));
      await taiLai().catch(() => undefined);
    }
  }, [data, token, year, month, ym, ky, taiLai]);

  const xoa = useCallback((k: string) => {
    if (/\|(ngay|ng)$/.test(k)) return;
    void luu(k, "");
  }, [luu]);

  const xoaDong = useCallback(async (id: number) => {
    try {
      await api.luong.xoaDongTayKhoan(token, id);
      setLoiGo(null);
    } catch (e) {
      setLoiGo(errText(e));
    }
    await taiLai().catch(() => undefined);
  }, [token, taiLai]);

  const menu = useCallback((k: string): MucMenu[] | null => {
    const [rk, cot] = k.split("|");
    const id = Number(rk.slice(1));
    if (rk[0] === "t") return [{ nhan: "Xoá dòng tay", lam: () => void xoaDong(id) }];
    if (rk[0] === "b" && cot === "tien" && data?.so.find((x) => x.batch_id === id)?.tay) {
      return [{ nhan: "Trả về số máy", lam: () => void luu(k, "") }];
    }
    if (rk[0] === "c" && cot === "cong" && data?.nguoi.find((x) => x.emp_id === id)?.cong_them != null) {
      return [{ nhan: "Xoá số", lam: () => void luu(k, "") }];
    }
    return null;
  }, [data, luu, xoaDong]);

  const moRieng = useCallback((k: string, o: HTMLElement) => {
    if (!k.endsWith("|ng")) return false;
    if (k.startsWith("t")) {
      const b = o.getBoundingClientRect();
      setNguoiMo({ id: Number(k.slice(1, k.indexOf("|"))), x: b.left, y: b.bottom + 2, tren: b.top });
    }
    return true;
  }, []);

  const doiNguoi = useCallback(async (id: number, ids: number[]) => {
    try {
      await api.luong.suaDongTayKhoan(token, id, { nguoi_ids: ids });
      setLoiGo(null);
    } catch (e) {
      setLoiGo(errText(e));
    }
    await taiLai().catch(() => undefined);
  }, [token, taiLai]);
  const dongNguoi = useCallback(() => setNguoiMo(null), []);
  const dongMo = nguoiMo ? data?.so.find((x) => x.dong_tay_id === nguoiMo.id) : undefined;

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
            {data.quy.dong_tay !== 0 && (<><div className="ktt-tom__dau">+</div>
              <div><div className="ktt-sub">Dòng tay</div><div>{money(data.quy.dong_tay)}</div></div></>)}
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
          {data.khoa && <div className="banner banner--info">Kỳ lương {ky} đã chốt nên không sửa tay được.</div>}
          {loiGo && <div className="banner banner--error">{loiGo}</div>}
          {!data.co_bang_luong && (
            <div className="banner banner--info">
              Kỳ {ky} chưa tạo bảng lương nên chưa có phân bổ lương bù lỗ và lương chính. Tạo ở tab Bảng lương tháng.
            </div>
          )}

          <LuoiGoTay duoc={duoc} luu={luu} xoa={xoa} menu={menu} moRieng={moRieng}>
          <h3>Chia cho người</h3>
          <div className="ktt-chu">
            <span className="ktt-o ktt-thang" />bên được trả<span className="ktt-o" />bên thua. Chênh lệch = lương
            khoán − phân bổ lương bù lỗ. Rê chuột vào tiền để xem thế số.
            {duoc && " Cộng thêm cộng thẳng vào lương, gõ số âm để trừ."}
          </div>
          <BangChia data={data} duoc={duoc} />
          {data.doi_chieu && <DoiChieu dc={data.doi_chieu} />}

          <h3>Sổ sản lượng</h3>
          {duoc && (
            <p className="ktt-hint">
              Bấm ô Tiền hoặc Ghi chú rồi gõ như Excel, Enter lưu. Dòng trống cuối sổ để thêm dòng tay (mặc định cả
              tổ, Enter ở ô Người tham gia để tick bớt). Ô có tam giác đỏ là số kế toán gõ, Delete trả về số máy,
              chuột phải để xoá dòng tay.
            </p>
          )}
          {data.so.length === 0 && !duoc ? <p className="ktt-trong">Tổ không có lần ghi nào ra tiền trong kỳ.</p> : (
            <BangSo ds={data.so} nhanTong="Tổ làm" coGhiChu duoc={duoc} moi={duoc} nhanNgayPhu={(d) => {
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
          </LuoiGoTay>
          {nguoiMo && dongMo && (
            <ChonNguoi x={nguoiMo.x} y={nguoiMo.y} tren={nguoiMo.tren} ds={data.thanh_vien} chon={dongMo.nguoi_ids}
              doi={(ids) => void doiNguoi(nguoiMo.id, ids)} dong={dongNguoi} />
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
