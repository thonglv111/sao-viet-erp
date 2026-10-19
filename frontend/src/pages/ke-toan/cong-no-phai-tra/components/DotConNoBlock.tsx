// Tab "Còn nợ" của ngăn Công nợ phải trả — kiểu 3 (docs/mockups/ke-toan-gon-3-phuong-an.html, 07/10/2026):
// MỘT lưới `.lds-g` (khung `.lds-bang`) gộp mọi đơn mua, thay mỗi đơn một bảng.
//
// Hàng đầu: "Nhóm theo đơn mua, tick đợt muốn trả" + nhóm nút "Đơn mua | Hạn trả".
// - Đơn mua: dòng nhóm (ô chọn cả đơn — tick khi mọi đợt chọn được đều đã chọn, gạch ngang khi chọn một
//   phần; mã đơn mở Đơn mua; "N đợt" mờ; "cọc còn X" mờ khi cọc của đơn còn dư) + 4 ô tổng của đơn, rồi
//   các dòng đợt.
// - Hạn trả: bỏ dòng nhóm, xếp đợt theo hạn trả tăng dần, đợt chưa có hạn ở cuối; ô Đợt mang cả mã đơn.
// Cột: ☐ | Đợt | Ngày nhận hàng | Số hoá đơn | Ký hiệu | Ngày hoá đơn | Hạn trả | Giá trị | Trừ cọc |
// Đã trả | Còn nợ — số, ký hiệu, ngày hoá đơn tách cột riêng như bên phải thu, ngày hoá đơn KHÔNG lẫn
// với ngày nhận hàng (13/10/2026; hạn trả tính từ ngày hoá đơn). Trừ cọc là cột RIÊNG (chủ chốt
// 27/08/2026): cầm sao kê nhà cung cấp dò không ra giao dịch nào cho phần cọc chiếu xuống. Bấm dòng đợt
// mở khối "Hàng của đợt" gấp ngay dưới (dòng con trải hết bảng). Dòng Cộng cuối bảng.
//
// Bề rộng: cột tiền 114px, Còn nợ 122px (tổng tỷ ở dòng Cộng không bị "…" cắt); cột co giãn có chỗ tối
// thiểu; bảng có bề rộng tối thiểu = tổng, khung `.lds-bang` cuộn ngang khi hẹp hơn — không cột nào về 0px.
import { FileText } from "lucide-react";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";

import { assetUrl, type PayableItemRow, type PayablesDetail } from "../../../../api/client";
import { ngay, vietSo } from "../../shared/dinhDang";
import { ChuHan, chuHanDu, HangXep, OTien } from "../../shared/NganCongNo";
import { gomTheoDon, tenKhoan } from "../shared/helpers";
import { HangCuaDot } from "./HangCuaDot";

type Xep = "don" | "han";

/** Bề rộng cột; null = cột co giãn (Số hoá đơn), số kèm là chỗ tối thiểu tính vào bề rộng bảng.
 *  Từ 13/10/2026 thêm Ngày nhận hàng, Ký hiệu, Ngày hoá đơn ⇒ bảng rộng hơn cột trái mặc định và
 *  cuộn ngang (kéo rộng ngăn để thấy hết), giống bên phải thu. Ghi chú cũ: tổng tối
 *  thiểu ≤818px: vừa cột trái của ngăn ở độ rộng mặc định (~840px, trừ thanh cuộn dọc) — không cuộn ngang;
 *  hẹp hơn (dưới 760px) thì khung cuộn. Cột tiền 114px (đủ 9,99 tỷ), Còn nợ 122px (tổng ở dòng Cộng),
 *  Hạn trả 154px (vừa "22/10/2026 còn 14", chữ đủ ở title). Số đã tính đệm ô 10px của lds-g. */
function cacCot(coChon: boolean, xep: Xep, coHoan = false): { rong: (number | null)[]; toiThieu: number } {
  // Xếp theo hạn: ô Đợt mang cả mã đơn ("PMH-0012 đợt 2") nên rộng hơn, Hoá đơn nhường lại.
  // Đo 08/10 (Be Vietnam Pro 13px): "22/10/2026 còn 14" (ChuHan gọn) ⇒ Hạn trả 152; Trừ cọc 104 (đủ
  // trăm triệu). Tổng ≤ 818 để vừa khung cột trái đo được 820px (824 cũ luôn hiện thanh cuộn).
  // Xếp theo hạn: "DMH-261007-VBF4 đợt 1" đo 189px, số HĐ tới 98px — không vừa 820 nên bảng cuộn ngang
  // (rê/kéo rộng ngăn), thà cuộn còn hơn "…" mất mã đơn.
  // Lưới lds-g đệm ô 10px (kt-g 9px) ⇒ mọi cột cố định +2px so với số đo trên; chỗ tối thiểu của cột co
  // giãn bớt 6px để tổng "Đơn mua" vẫn 816 ≤ 820.
  const dot = xep === "don" ? 58 : 194;
  // Tiêu đề "Ngày nhận hàng" / "Ngày hoá đơn" đo ~100px + đệm ⇒ 120 / 114; số hoá đơn co giãn, tối thiểu 112.
  const coGian = 112;
  // Cột "NCC hoàn" chỉ khi có khoản hoàn (#73) — không có thì bảng giữ bề rộng cũ.
  const rong = [...(coChon ? [38] : []), dot, 120, null, 88, 114, 154, 114, 106, 114, ...(coHoan ? [106] : []), 122];
  return { rong, toiThieu: rong.reduce<number>((t, w) => t + (w ?? coGian), 0) };
}

/** Ô chọn cả đơn: `indeterminate` không đặt được bằng thuộc tính JSX nên gán qua ref. */
function OChonDon({ ma, chon, mot, khoa, onDoi }: { ma: string; chon: boolean; mot: boolean; khoa: boolean; onDoi: (bat: boolean) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = mot;
  }, [mot]);
  return (
    <input ref={ref} type="checkbox" className="kt-ck" checked={chon} disabled={khoa}
      aria-label={`Chọn mọi đợt còn nợ của ${ma}`} onChange={(e) => onDoi(e.target.checked)} />
  );
}

/** Hạn trả của MỘT đợt: ngày + "trễ / còn N ngày"; đợt chưa có hạn không bao giờ vào Quá hạn nên phải nói. */
function OHanTra({ row, homNay }: { row: PayableItemRow; homNay: string }) {
  if (row.da_tat_toan) return <span className="lds-mu3">đã trả xong</span>;
  if (row.chua_dat_han || !row.due_date) {
    return <span className="lds-mu3">{row.delivery_id == null ? "không theo đợt" : "chưa đặt hạn"}</span>;
  }
  return (
    <>
      <span>{ngay(row.due_date)}</span>
      <ChuHan han={row.due_date} homNay={homNay} gon lop={{ do: "lds-do", mo: "lds-mu", vang: "lds-vang" }} />
    </>
  );
}

/** Số hoá đơn của đợt (ký hiệu đứng cột riêng) + tệp hoá đơn đính lúc ghi đợt giao bên Thu mua
 *  (chỉ đọc, mở tab mới). */
function OHoaDon({ row }: { row: PayableItemRow }) {
  const tep = row.hoa_don_files ?? [];
  return (
    <>
      {row.invoice_number ? <span>{row.invoice_number}</span> : <span className="lds-mu3">chưa có</span>}
      {tep.length > 0 && (
        <a className="kt-lk kt-ncn-ben" href={assetUrl(tep[0].file_url) ?? "#"} target="_blank" rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          aria-label={tep.length > 1 ? `Xem ${tep[0].file_name} và ${tep.length - 1} tệp khác` : `Xem ${tep[0].file_name}`}>
          <FileText size={13} aria-hidden="true" />
          {tep.length > 1 && <span>{tep.length}</span>}
        </a>
      )}
    </>
  );
}

const cong = (ds: PayableItemRow[], k: "amount" | "coc_bu" | "paid" | "con_no" | "hoan_ncc") =>
  ds.reduce((s, r) => s + (r[k] ?? 0), 0);

export function DotConNoBlock({
  detail,
  khoanNo,
  dangLoc,
  coChon,
  chonDuoc,
  chon,
  onChon,
  moHang,
  onMoHang,
  onMoDon,
}: {
  detail: PayablesDetail;
  /** Các đợt đang hiện (đã lọc), giữ thứ tự máy chủ đã sắp. */
  khoanNo: PayableItemRow[];
  /** Đang lọc ⇒ câu "rỗng" nói về bộ lọc, không nói "không còn nợ". */
  dangLoc: boolean;
  /** Có quyền lập phiếu chi ⇒ có cột ô chọn. */
  coChon: boolean;
  chonDuoc: (row: PayableItemRow) => boolean;
  chon: ReadonlySet<number>;
  onChon: (next: Set<number>) => void;
  /** Khoá dòng đang mở khối hàng ("đơn:đợt"). */
  moHang: string | null;
  onMoHang: (khoa: string | null) => void;
  /** Không có = không có quyền xem Đơn mua ⇒ mã đơn là chữ thường. */
  onMoDon?: (code: string) => void;
}) {
  const [xep, setXep] = useState<Xep>("don");

  if (khoanNo.length === 0) {
    return (
      <p className="kt-mo">
        {dangLoc ? "Không có đợt nào còn nợ ở mục này." : "Không còn đợt nào nợ nhà cung cấp này."}
      </p>
    );
  }

  // NCC hoàn tiền không gắn đơn cộng nợ lại vào đợt hạn muộn nhất (#36). Có khoản đó thì phải có
  // cột riêng, không thì "Giá trị − Trừ cọc − Đã trả" không ra Còn nợ (#73).
  const coHoan = khoanNo.some((r) => (r.hoan_ncc ?? 0) > 0);
  const { rong, toiThieu } = cacCot(coChon, xep, coHoan);
  const soCot = rong.length;

  function dao(ids: number[], bat: boolean) {
    const next = new Set(chon);
    for (const id of ids) {
      if (bat) next.add(id);
      else next.delete(id);
    }
    onChon(next);
  }

  function dongDot(row: PayableItemRow, coMaDon: boolean) {
    const khoa = `${row.purchase_request_id}:${row.delivery_id ?? "don"}`;
    // Dòng "cả đơn" (phiếu CŨ) không có hàng nào quy về được ⇒ không mở khối hàng.
    const coHang = row.lines.length > 0;
    const mo = coHang && moHang === khoa;
    const daTich = row.delivery_id != null && chon.has(row.delivery_id);
    const lop = [coHang ? "lds-dong" : "", row.da_tat_toan ? "kt-xong" : ""].filter(Boolean).join(" ");
    const bam = () => coHang && onMoHang(mo ? null : khoa);
    return (
      <Fragment key={khoa}>
        <tr className={lop || undefined} tabIndex={coHang ? 0 : undefined} aria-expanded={coHang ? mo : undefined}
          title={coHang ? "Bấm để xem hàng của đợt" : undefined}
          onClick={bam}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return;
            // Esc trên dòng đang mở: gấp khối hàng, KHÔNG đóng ngăn (ngăn bỏ qua phím đã
            // preventDefault). Esc lần nữa mới tới ngăn.
            if (e.key === "Escape" && mo) {
              e.preventDefault();
              onMoHang(null);
              return;
            }
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              bam();
            }
          }}>
          {coChon && (
            <td className="c" onClick={(e) => e.stopPropagation()}>
              {row.delivery_id == null ? (
                // Đơn cũ không theo đợt: ô mờ + lời giải thích, không giấu đi — giấu thì người dùng
                // tưởng dòng này trả gộp được mà không ra. Máy chủ chặn phiếu thanh toán không gắn
                // đợt (luật 09/08/2026) và màn Đơn mua hàng không có nút lập phiếu chi ⇒ nói đúng lý
                // do, không chỉ tới chỗ không làm được (#56, 18/10/2026).
                <input type="checkbox" className="kt-ck" disabled
                  aria-label={`Chọn ${tenKhoan(row)} của ${row.code}`}
                  title="Đơn nhận hàng kiểu cũ, không theo đợt giao. Phiếu thanh toán phải gắn đợt giao nên đơn này chưa trả được ở đây." />
              ) : chonDuoc(row) ? (
                <input type="checkbox" className="kt-ck" checked={daTich}
                  aria-label={`Chọn ${tenKhoan(row)} của ${row.code}`}
                  onChange={(e) => dao([row.delivery_id as number], e.target.checked)} />
              ) : null}
            </td>
          )}
          {coMaDon ? (
            <td title={`${row.code} ${tenKhoan(row).toLowerCase()}`}>
              {row.code}
              <span className="lds-mu kt-ncn-ben">{tenKhoan(row).toLowerCase()}</span>
            </td>
          ) : (
            <td>{tenKhoan(row)}</td>
          )}
          <td>{row.delivery_date ? ngay(row.delivery_date) : ""}</td>
          <td title={row.invoice_number ?? undefined}>
            <OHoaDon row={row} />
          </td>
          <td className="lds-mu">{row.invoice_symbol ?? ""}</td>
          <td>{row.invoice_date ? ngay(row.invoice_date) : ""}</td>
          <td title={!row.da_tat_toan && !row.chua_dat_han && row.due_date ? chuHanDu(row.due_date, detail.as_of) : undefined}>
            <OHanTra row={row} homNay={detail.as_of} />
          </td>
          <td className="n">{vietSo(row.amount)}</td>
          <td className="n"><OTien so={row.coc_bu} /></td>
          <td className="n"><OTien so={row.paid} /></td>
          {coHoan && <td className="n"><OTien so={row.hoan_ncc ?? 0} /></td>}
          <td className="n"><OTien so={row.con_no} /></td>
        </tr>
        {mo && <HangCuaDot item={row} soCot={soCot} />}
      </Fragment>
    );
  }

  let than: ReactNode;
  if (xep === "han") {
    // Hạn tăng dần, đợt chưa có hạn sau, đợt đã trả xong (chỉ để dò cọc) cuối cùng; cùng hạn giữ thứ tự
    // máy chủ (sort ổn định).
    const ds = [...khoanNo].sort((a, b) =>
      a.da_tat_toan !== b.da_tat_toan ? (a.da_tat_toan ? 1 : -1)
        : a.due_date === b.due_date ? 0 : a.due_date == null ? 1 : b.due_date == null ? -1 : a.due_date < b.due_date ? -1 : 1);
    than = ds.map((row) => dongDot(row, true));
  } else {
    than = gomTheoDon(khoanNo, detail.coc_chung).map((don) => {
      const idChon = don.items.filter(chonDuoc).map((r) => r.delivery_id as number);
      const soDaChon = idChon.filter((id) => chon.has(id)).length;
      const tenNhom = `${don.code} ${vietSo(don.items.length)} đợt${don.coc && don.coc.con_du > 0 ? ` cọc còn ${vietSo(don.coc.con_du)}` : ""}`;
      return (
        <Fragment key={don.purchase_request_id}>
          <tr className="lds-cong lds-nhom">
            {coChon && (
              <td className="c">
                <OChonDon ma={don.code} chon={idChon.length > 0 && soDaChon === idChon.length}
                  mot={soDaChon > 0 && soDaChon < idChon.length} khoa={idChon.length === 0}
                  onDoi={(bat) => dao(idChon, bat)} />
              </td>
            )}
            <td colSpan={6} title={tenNhom}>
              <span className="lds-dinh-trai">
                {onMoDon ? (
                  <button type="button" className="kt-lk" onClick={() => onMoDon(don.code)}>{don.code}</button>
                ) : (
                  <span>{don.code}</span>
                )}
                <span className="lds-mu kt-ncn-ben">{`${vietSo(don.items.length)} đợt`}</span>
                {/* Cọc của CHÍNH đơn này còn dư (chưa chiếu hết xuống các đợt). */}
                {don.coc && don.coc.con_du > 0 && (
                  <span className="lds-mu kt-ncn-ben">{`cọc còn ${vietSo(don.coc.con_du)}`}</span>
                )}
              </span>
            </td>
            <td className="n">{vietSo(cong(don.items, "amount"))}</td>
            <td className="n"><OTien so={cong(don.items, "coc_bu")} /></td>
            <td className="n"><OTien so={cong(don.items, "paid")} /></td>
            {coHoan && <td className="n"><OTien so={cong(don.items, "hoan_ncc")} /></td>}
            <td className="n"><OTien so={don.con_no} /></td>
          </tr>
          {don.items.map((row) => dongDot(row, false))}
        </Fragment>
      );
    });
  }

  return (
    <>
      <HangXep<Xep>
        chu={`${xep === "don" ? "Nhóm theo đơn mua" : "Xếp theo hạn trả, sớm nhất trên cùng"}${coChon ? ", tick đợt muốn trả" : ""}`}
        giaTri={xep}
        luaChon={[["don", "Đơn mua"], ["han", "Hạn trả"]]}
        onDoi={setXep}
      />
      <div className="lds-bang">
        <table className="lds-g" style={{ minWidth: toiThieu }} aria-label="Các đợt còn nợ">
          <colgroup>
            {rong.map((w, i) => <col key={i} style={w ? { width: w } : undefined} />)}
          </colgroup>
          <thead>
            <tr>
              {coChon && <th aria-label="Chọn" />}
              <th>{xep === "don" ? "Đợt" : "Đơn mua và đợt"}</th>
              <th>Ngày nhận hàng</th>
              <th>Số hoá đơn</th>
              <th>Ký hiệu</th>
              <th>Ngày hoá đơn</th>
              <th>Hạn trả</th>
              <th className="n">Giá trị</th>
              <th className="n">Trừ cọc</th>
              <th className="n">Đã trả</th>
              {coHoan && <th className="n" title="Nhà cung cấp hoàn tiền không gắn đơn, cộng nợ lại vào đợt hạn muộn nhất">NCC hoàn</th>}
              <th className="n">Còn nợ</th>
            </tr>
          </thead>
          <tbody>
            {than}
            <tr className="lds-cong">
              {coChon && <td />}
              <td colSpan={6}>{`Cộng ${vietSo(khoanNo.length)} đợt`}</td>
              <td className="n">{vietSo(cong(khoanNo, "amount"))}</td>
              <td className="n"><OTien so={cong(khoanNo, "coc_bu")} /></td>
              <td className="n"><OTien so={cong(khoanNo, "paid")} /></td>
              {coHoan && <td className="n"><OTien so={cong(khoanNo, "hoan_ncc")} /></td>}
              <td className="n"><OTien so={cong(khoanNo, "con_no")} /></td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
