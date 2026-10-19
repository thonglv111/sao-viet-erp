// Ngăn TẠO / SỬA đơn mua hàng — phương án A "bảng phẳng" (docs/mockups/mua-hang-lap-don-gop-3-phuong-an.html,
// chốt 10/10/2026). Khuôn "Order Requisitions" của NetSuite: MỘT bảng, mỗi món một dòng thấp, nhà cung
// cấp là một CỘT của dòng; máy tự tách đơn theo nhà cung cấp lúc lưu. Dải "Sẽ tạo" ở chân ngăn nói đơn
// nào bao nhiêu tiền. Khổ mua, chiết khấu, ghi chú mở bằng nút cuối dòng thành một dòng con ngay dưới.
// ⚠️ KHỐI CẤM XÉ — TÂM THUẾ: `lineDiscountAmount`, `lineVatAmount`, `lineTotal` ở shared/helpers.
// Hàm `save` (validate + gọi API) CỐ Ý Ở LẠI SHELL và truyền xuống làm handler của <form>.
import { useEffect, useRef, useState, type Dispatch, type FormEvent, type SetStateAction } from "react";
import { api, type DonViDungDuoc, type HangLoai, type PurchaseRequestRow, type SupplierRow } from "../../../../api/client";
import { coDonViGoc } from "../../../../lib/khoGiay";
import { useAuth } from "../../../../auth/useAuth";
import { Button } from "../../../../components/Button";
import { ChonNgay } from "../../../../components/ChonNgay";
import { Icon } from "../../../../components/Icons";
import { KhungKho } from "../../../../components/kho-giay/KhungKho";
import { NganPhai } from "../../../ke-toan/shared/NganPhai";
// Đơn vị lưu bằng MÃ (`cai`), tên hiển thị ("cái") nằm ở danh mục Đơn vị — xem pages/tenDonVi.ts.
import { tenDonVi } from "../../../tenDonVi";
import {
  applySupplierPrices,
  bestSupplierIdForLines,
  chaoGiaChoMatHang,
  lineDiscountAmount,
  lineTotal,
  lineVatAmount,
  tenGon,
} from "../shared/helpers";
import { dongDuocChon } from "../shared/types";
import type { FormLine, FormState, PhieuSeTao } from "../shared/types";
import { LineSupplierPicker } from "./LineSupplierPicker";
import { OMuaCho } from "../../mua-cho/OMuaCho";
import { StatusBadge } from "./purchaseCells";
import "../../../ke-toan/ke-toan.css";
import "../../../kho-ngan-a.css";
import "../../yeu-cau-mua-hang/components/yc-form-a.css";
import "./don-form-a.css";

const so = (n: number) => Math.round(n).toLocaleString("vi-VN");
const MUC_VAT = [0, 5, 8, 10];
const ngayVN = (d: string) => d.split("-").reverse().join("/");

type Nguon = { code: string; bo_phan: string | null; needed_date: string };

/** "9 yêu cầu, 5 bộ phận" cạnh tiêu đề — bấm mới hiện danh sách mã. Trước đây mỗi mã một thẻ
 *  chiếm ba hàng đầu ngăn. */
function NutNguon({ nguon }: { nguon: Nguon[] }) {
  const [mo, setMo] = useState(false);
  const goc = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    if (!mo) return;
    const dong = (e: MouseEvent) => {
      if (!goc.current?.contains(e.target as Node)) setMo(false);
    };
    document.addEventListener("mousedown", dong);
    return () => document.removeEventListener("mousedown", dong);
  }, [mo]);
  const soBoPhan = new Set(nguon.map((n) => n.bo_phan).filter(Boolean)).size;
  const nhan = nguon.length === 1
    ? `Từ ${nguon[0].code}`
    : `${nguon.length} yêu cầu${soBoPhan ? `, ${soBoPhan} bộ phận` : ""}`;
  return (
    <span className="dfa-nguon" ref={goc}>
      <button type="button" className="dfa-nguon__nut" aria-expanded={mo} onClick={() => setMo((v) => !v)}>
        {nhan}
      </button>
      {mo && (
        <div className="dfa-nguon__ds" role="dialog" aria-label="Các yêu cầu của đơn">
          <div className="dfa-nguon__dong dfa-nguon__dong--dau"><span>Yêu cầu</span><span>Bộ phận</span><span>Cần ngày</span></div>
          {nguon.map((n) => (
            <div key={n.code} className="dfa-nguon__dong">
              <span>{n.code}</span>
              <span>{n.bo_phan ?? ""}</span>
              <span>{n.needed_date ? ngayVN(n.needed_date) : ""}</span>
            </div>
          ))}
        </div>
      )}
    </span>
  );
}

export function PurchaseFormDrawer({
  mode,
  setMode,
  editing,
  form,
  setForm,
  setLine,
  save,
  saving,
  formError,
  suppliers,
  minPurchaseDate,
  expectedReceiptMinDate,
  phieuSeTao,
  nguon = [],
}: {
  mode: "create" | "edit";
  setMode: Dispatch<SetStateAction<null | "create" | "edit">>;
  editing: PurchaseRequestRow | null;
  form: FormState;
  setForm: Dispatch<SetStateAction<FormState>>;
  setLine: (index: number, patch: Partial<FormLine>) => void;
  /** Chính là `save` của shell — đừng bê nó vào đây. */
  save: (e: FormEvent) => Promise<void>;
  saving: boolean;
  formError: string | null;
  suppliers: SupplierRow[];
  minPurchaseDate: string;
  expectedReceiptMinDate: string;
  phieuSeTao: PhieuSeTao[];
  /** Yêu cầu nguồn (mã + bộ phận) — nút cạnh tiêu đề lúc lập đơn từ yêu cầu. */
  nguon?: Nguon[];
}) {
  const [moTuyChon, setMoTuyChon] = useState<Set<number>>(new Set());
  // Ô thiếu chỉ tô đỏ SAU lần bấm Lưu đầu tiên — mở ngăn ra mà cả cột đã đỏ thì trông như màn đang lỗi.
  const [daBamLuu, setDaBamLuu] = useState(false);
  const taoMoi = mode !== "edit";
  const nccCua = (id: number | null | undefined) => suppliers.find((s) => s.id === id) ?? null;
  const { token } = useAuth();

  // Danh sách đơn vị của từng mã GIẤY / VẬT TƯ KHÁC trên form (bản gộp nhóm của mọi đơn vị đã khai)
  // — để biết NCC bán cùng nhóm đơn vị với dòng hay không, và quy giá ram ↔ tờ, tấn ↔ kg. Khoá
  // `loai:id` (giấy và vật tư đánh số độc lập). Các lời gọi cùng nhịp được máy khách gộp thành một
  // request.
  const [dsDonVi, setDsDonVi] = useState<Record<string, DonViDungDuoc[]>>({});
  const maHang = [...new Set(form.lines
    .filter((l) => coDonViGoc(l.hang_loai) && l.hang_id)
    .map((l) => `${l.hang_loai}:${l.hang_id}`))]
    .sort()
    .join(",");
  useEffect(() => {
    if (!token || !maHang) return;
    let huy = false;
    const thieu = maHang.split(",").filter((k) => !(k in dsDonVi));
    for (const k of thieu) {
      const [hl, id] = k.split(":");
      api.matHang
        .donVi(token, hl as HangLoai, Number(id))
        .then((r) => { if (!huy) setDsDonVi((cu) => ({ ...cu, [k]: r.ds })); })
        .catch(() => { /* Không nạp được: dòng khác ĐVT coi là khác họ — không tự gán sai giá. */ });
    }
    return () => { huy = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, maHang]);
  const dsCua = (l: FormLine) =>
    (coDonViGoc(l.hang_loai) && l.hang_id ? dsDonVi[`${l.hang_loai}:${l.hang_id}`] : undefined);

  // Thứ tự dòng chốt MỘT LẦN lúc mở ngăn: món chưa có nhà cung cấp lên đầu. Chọn nhà cung cấp xong
  // dòng KHÔNG nhảy chỗ — đang nhập từ trên xuống mà dòng chạy đi là mất dấu.
  const thuTu = useRef<number[]>([]);
  if (thuTu.current.length !== form.lines.length) {
    thuTu.current = form.lines
      .map((_, i) => i)
      .sort((a, b) => (taoMoi ? (form.lines[a].supplier_id ? 1 : 0) - (form.lines[b].supplier_id ? 1 : 0) : 0));
  }

  const dangChon = form.lines.filter(dongDuocChon);
  const soMon = dangChon.length;
  const chuaCoNcc = taoMoi ? dangChon.filter((l) => !l.supplier_id).length : 0;
  const soDon = taoMoi ? phieuSeTao.length : 1;
  const tinh = (ds: FormLine[]) => ({
    hang: ds.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.expected_unit_price) || 0), 0),
    giam: ds.reduce((s, l) => s + lineDiscountAmount(l), 0),
    vat: ds.reduce((s, l) => s + lineVatAmount(l), 0),
    tong: ds.reduce((s, l) => s + lineTotal(l), 0),
  });
  const tongCong = tinh(dangChon);
  const canNhat = nguon.map((n) => n.needed_date).filter(Boolean).sort()[0];
  // Đơn gom món của nhiều yêu cầu ⇒ ghi mã yêu cầu + bộ phận dưới tên vật tư; một yêu cầu thì nút đầu ngăn đã nói.
  const nhieuYeuCau = new Set(form.lines.map((l) => l.yeu_cau_ma).filter(Boolean)).size > 1;
  const boPhanCua = new Map(nguon.map((n) => [n.code, n.bo_phan]));
  const nhieuBoPhan = new Set(nguon.map((n) => n.bo_phan).filter(Boolean)).size > 1;
  const soCot = taoMoi ? 7 : 6;

  const batTuyChon = (index: number) =>
    setMoTuyChon((s) => {
      const moi = new Set(s);
      if (moi.has(index)) moi.delete(index);
      else moi.add(index);
      return moi;
    });

  function dongBang(index: number) {
    const line = form.lines[index];
    const chon = dongDuocChon(line);
    const laGiay = line.hang_loai === "giay";
    const ds = dsCua(line);
    const dv = tenDonVi(line.unit) ?? line.unit;
    const tuyChon = chon && (moTuyChon.has(index) || (Number(line.discount_percent) || 0) > 0);
    // Giá sổ: giá cùng khổ + cùng họ đơn vị của NCC đang chọn, quy về ĐVT dòng — chỉ hiện khi đơn
    // giá gõ LỆCH sổ.
    const so_ = line.supplier_id
      ? chaoGiaChoMatHang(line, suppliers, ds).find((c) => c.supplier_id === line.supplier_id && c.cung_ho)
      : undefined;
    const giaSo = so_?.gia_dong ?? null;
    const lech = giaSo != null && line.expected_unit_price > 0 ? line.expected_unit_price - giaSo : 0;
    const thanhTien = line.quantity > 0 && line.expected_unit_price > 0 ? lineTotal(line) : null;
    const boPhan = line.yeu_cau_ma ? boPhanCua.get(line.yeu_cau_ma) : null;
    // "Theo yêu cầu" là trường hợp thường — chỉ dựng chip khi món mua cho tồn kho hoặc cho lệnh.
    const coMuaCho = (line.mua_cho?.length ?? 0) > 0 || (line.loai_mua != null && line.loai_mua !== "theo_yeu_cau");
    // Khổ mua của dòng giấy: hai cạnh, hoặc chỉ rộng. Chưa có khổ thì thẻ mời ghi — NCC chỉ được so
    // trong cùng khổ, không khổ là không ai khớp.
    const khoChu = !laGiay
      ? null
      : line.kho_rong && line.kho_dai
        ? `${line.kho_rong} × ${line.kho_dai} mm`
        : line.kho_rong ? `khổ ${line.kho_rong} mm` : "Chưa có khổ";
    return [
      <tr key={index} className={chon ? undefined : "kna-mo"}>
        <td>
          <div className="dfa-ten">
            {taoMoi && (
              <input
                type="checkbox"
                aria-label={`Đưa ${line.item_name} vào đơn`}
                checked={chon}
                onChange={(e) => setLine(index, { chon: e.target.checked })}
              />
            )}
            <div className="dfa-ten__than">
              <div className="dfa-ten__chu" title={line.item_name}>{line.item_name}</div>
              <div className="dfa-phu">
                {!chon ? (
                  <span>Không vào đơn này, dòng yêu cầu vẫn mở</span>
                ) : (
                  <>
                    {khoChu && (
                      <button type="button" className="dfa-the-nho dfa-the-nho--bam" title="Sửa khổ mua"
                        onClick={() => batTuyChon(index)}>{khoChu}</button>
                    )}
                    {nhieuYeuCau && line.yeu_cau_ma && <span className="dfa-the-nho">{line.yeu_cau_ma}</span>}
                    {nhieuBoPhan && boPhan && <span className="dfa-the-nho">{boPhan}</span>}
                    {coMuaCho && <OMuaCho loai={line.loai_mua ? [line.loai_mua] : []} lenh={line.mua_cho} donVi={dv} />}
                  </>
                )}
              </div>
            </div>
          </div>
        </td>
        {taoMoi && (
          <td>
            {chon && (
              <span className="dfa-ncc">
                <LineSupplierPicker
                  line={line}
                  suppliers={suppliers}
                  dsDonVi={ds}
                  loi={daBamLuu}
                  onPick={(chao) =>
                    setLine(index, {
                      supplier_id: chao?.supplier_id ?? null,
                      // Chọn NCC là lấy luôn GIÁ CỦA CHÍNH HỌ.
                      ...(chao && !chao.cung_ho
                        ? {
                            // NCC bán khác họ đơn vị (dòng tính tờ, NCC bán kg — 10/10/2026): dòng
                            // đổi sang đơn vị + giá của NCC; số lượng cũ không còn nghĩa (tờ không
                            // quy ra kg) ⇒ xoá để người lập gõ lại.
                            unit: chao.unit,
                            expected_unit_price: chao.unit_price,
                            vat_percent: chao.vat_percent,
                            // Giữ số đề nghị GỐC (đổi NCC lần hai không đè). NCC bán lại đúng ĐVT
                            // đề nghị thì trả số lượng gốc về luôn.
                            ...(() => {
                              const goc = line.de_nghi ?? { so: line.quantity, unit: line.unit };
                              return goc.unit === chao.unit
                                ? { quantity: goc.so, de_nghi: null }
                                : { quantity: 0, de_nghi: goc };
                            })(),
                          }
                        : chao
                          ? {
                              // ĐVT giữ nguyên của DÒNG. KHÔNG lấy `chao.unit`.
                              unit: line.unit || chao.unit,
                              // ⚠️ GIÁ ĐÃ QUY ĐỔI về đơn vị của dòng, không phải giá thô
                              // (29/08/2026): NCC báo 1.020.000đ/ram, dòng tính tờ ⇒ 2.040đ/tờ.
                              // Không quy được ⇒ để trống cho người lập gõ.
                              expected_unit_price: chao.gia_dong ?? 0,
                              vat_percent: chao.vat_percent,
                            }
                          : {}),
                    })
                  }
                />
              </span>
            )}
          </td>
        )}
        <td className="n">
          {/* SỐ LƯỢNG MUA sửa được: mua khổ to hơn rồi tề, NCC chỉ bán chẵn ram… Mặc định = số yêu cầu. */}
          {/* Đổi ĐVT theo NCC: ô trống viền vàng + dòng xám số đề nghị gốc để quy đổi — không
              dựng câu cảnh báo (cột hẹp, câu gãy hai dòng đỏ cả bảng). */}
          <label className={`ycf-gi dfa-gi${
            daBamLuu && chon && !(line.quantity > 0) ? " loi"
              : chon && line.de_nghi && !(line.quantity > 0) ? " dfa-gi--cho" : ""}`}>
            <input
              inputMode="decimal"
              disabled={!chon}
              required={chon}
              aria-label={`Số lượng mua ${line.item_name}`}
              placeholder={chon && line.de_nghi ? `Số ${dv}` : undefined}
              value={line.quantity > 0 ? String(line.quantity) : ""}
              onChange={(e) => setLine(index, {
                quantity: Number(e.target.value.replace(",", ".").replace(/[^\d.]/g, "")) || 0,
              })}
            />
            <span title={line.de_nghi ? "Đơn vị nhà cung cấp bán" : "Đơn vị do bộ phận đề nghị khai"}>{dv}</span>
          </label>
          {chon && line.de_nghi && (
            <div className="dfa-duoi dfa-duoi--1" title="Số lượng bộ phận đề nghị, trước khi đổi đơn vị theo nhà cung cấp">
              Đề nghị {line.de_nghi.so > 0 ? so(line.de_nghi.so) : "?"} {tenDonVi(line.de_nghi.unit) ?? line.de_nghi.unit}
            </div>
          )}
        </td>
        <td className="n">
          <label className={`ycf-gi dfa-gi${daBamLuu && chon && !(line.expected_unit_price > 0) ? " loi" : ""}`}>
            <input
              inputMode="numeric"
              disabled={!chon}
              aria-label="Đơn giá dự kiến"
              value={line.expected_unit_price > 0 ? line.expected_unit_price.toLocaleString("vi-VN") : ""}
              onChange={(e) => setLine(index, { expected_unit_price: Number(e.target.value.replace(/\D/g, "")) || 0 })}
            />
            <span>đ/{dv}</span>
          </label>
          {chon && lech !== 0 && (
            <div className={`dfa-duoi${lech > 0 ? " ycd-vang" : ""}`}>
              {lech > 0 ? "Cao" : "Thấp"} hơn giá sổ {so(Math.abs(lech))}
            </div>
          )}
        </td>
        <td className="n">
          <select
            className="kna-o dfa-vat"
            aria-label="Thuế GTGT phần trăm"
            disabled={!chon}
            value={line.vat_percent ?? 0}
            onChange={(e) => setLine(index, { vat_percent: Number(e.target.value) })}
          >
            {[...new Set([...MUC_VAT, Number(line.vat_percent) || 0])].sort((a, b) => a - b).map((v) => (
              <option key={v} value={v}>{v} %</option>
            ))}
          </select>
        </td>
        <td className="n">
          {thanhTien != null && chon ? (
            <span className="kna-so" title={`${so(thanhTien)} đ`}>{so(thanhTien)}</span>
          ) : (
            <span className="kna-mo">{chon ? "Chưa tính" : ""}</span>
          )}
        </td>
        <td>
          {chon && (
            <button type="button" className={`dfa-nut-tuy${tuyChon ? " is-mo" : ""}`}
              aria-label={laGiay ? "Khổ mua, chiết khấu, ghi chú" : "Chiết khấu, ghi chú"}
              title={laGiay ? "Khổ mua, chiết khấu, ghi chú" : "Chiết khấu, ghi chú"}
              onClick={() => batTuyChon(index)}>
              <Icon name={tuyChon ? "minus" : "plus"} size={13} />
            </button>
          )}
        </td>
      </tr>,
      tuyChon ? (
        <tr key={`${index}-tuy`} className="dfa-dong-tuy">
          <td colSpan={soCot}>
            <div className="dfa-tuy">
              {laGiay && (
                <span className="dfa-tuy__o">
                  <span className="kna-mo">Khổ mua</span>
                  <KhungKho
                    ariaLabel="Khổ mua"
                    rong={line.kho_rong ?? 0}
                    dai={line.kho_dai ?? 0}
                    onChange={(v) => setLine(index, { kho_rong: v.rong, kho_dai: v.dai })}
                  />
                </span>
              )}
              <label className="ycf-gi dfa-gi--nho">
                <span>Giảm</span>
                <input
                  inputMode="decimal"
                  aria-label="Giảm giá phần trăm"
                  value={line.discount_percent > 0 ? String(line.discount_percent) : ""}
                  onChange={(e) => setLine(index, { discount_percent: Math.min(100, Number(e.target.value.replace(",", ".").replace(/[^\d.]/g, "")) || 0) })}
                />
                <span>%</span>
              </label>
              {lineDiscountAmount(line) > 0 && <span className="kna-mo">trừ {so(lineDiscountAmount(line))} đ</span>}
              <input
                className="ycf-ghi dfa-tuy__ghi"
                aria-label="Ghi chú dòng"
                placeholder="Ghi chú dòng"
                value={line.note ?? ""}
                onChange={(e) => setLine(index, { note: e.target.value })}
              />
            </div>
          </td>
        </tr>
      ) : null,
    ];
  }

  // Dải "Sẽ tạo": mỗi đơn một thẻ (tên gọn + số món + tiền), rê chuột ra tên đủ + tiền hàng / chiết khấu / VAT.
  const theoNcc = new Map<number, FormLine[]>();
  if (taoMoi) for (const l of dangChon) if (l.supplier_id) theoNcc.set(l.supplier_id, [...(theoNcc.get(l.supplier_id) ?? []), l]);
  const theDon = [...theoNcc.entries()].map(([id, ds]) => {
    const t = tinh(ds);
    const ten = nccCua(id)?.name ?? `NCC #${id}`;
    return (
      <span key={id} className="dfa-don"
        title={`${ten}. Tiền hàng ${so(t.hang)}${t.giam ? `, chiết khấu ${so(t.giam)}` : ""}, VAT ${so(t.vat)}`}>
        <span className="dfa-don__ten">{tenGon(ten)}</span>
        <span className="kna-mo">{ds.length} món</span>
        <span className="kna-so">{so(t.tong)}</span>
      </span>
    );
  });

  const chan = (
    <>
      <div className="dfa-se-tao">
        {taoMoi ? (
          <>
            <span className="kna-mo">Sẽ tạo</span>
            {/* Món chưa có NCC không nhắc ở đây — dòng chữ đỏ cạnh nút Lưu đã nói. */}
            {theDon.length ? theDon : <span className="kna-mo">chưa có đơn nào</span>}
          </>
        ) : (
          <>
            <span className="kna-mo">Tiền hàng</span><span className="kna-so">{so(tongCong.hang)}</span>
            {tongCong.giam > 0 && <><span className="kna-mo">Chiết khấu</span><span className="kna-so">{so(-tongCong.giam)}</span></>}
            <span className="kna-mo">VAT</span><span className="kna-so">{so(tongCong.vat)}</span>
          </>
        )}
        <span className="dfa-se-tao__tong">
          <span className="kna-mo">Tổng</span>
          <span className="kna-so">{so(tongCong.tong)} đ</span>
        </span>
      </div>
      <span className="ycf-xt">
        {taoMoi && chuaCoNcc > 0 ? (
          <span className="ycd-do">Còn {chuaCoNcc} món chưa chọn nhà cung cấp</span>
        ) : taoMoi ? (
          <span>Lưu xong mỗi đơn ở trạng thái Nháp.</span>
        ) : (
          <span>{soMon} món</span>
        )}
      </span>
      <span className="rc__spacer" />
      <Button variant="ghost" onClick={() => setMode(null)} disabled={saving}>Huỷ</Button>
      <Button type="submit" form="dmh-form" variant="accent" loading={saving}>
        {taoMoi ? (soDon > 1 ? `Lưu ${soDon} đơn` : "Lưu đơn") : "Lưu thay đổi"}
      </Button>
    </>
  );

  return (
    <NganPhai
      duongDan={taoMoi ? "Mua hàng > Lập đơn từ yêu cầu" : `Mua hàng > ${editing?.code ?? ""}`}
      tieuDe={taoMoi ? "Đơn mua hàng mới" : (editing?.code ?? "Sửa đơn mua hàng")}
      the={
        taoMoi ? (
          nguon.length ? <NutNguon nguon={nguon} /> : undefined
        ) : editing ? (
          <StatusBadge status={editing.status} />
        ) : undefined
      }
      chan={chan}
      onDong={() => setMode(null)}
    >
      <form
        id="dmh-form"
        className="kna"
        onSubmit={(e) => {
          setDaBamLuu(true);
          return save(e);
        }}
        onInvalidCapture={() => setDaBamLuu(true)}
      >
        {formError && <div className="kna-canh kna-canh--do" role="alert">{formError}</div>}
        {/* Ô chung của mọi đơn sẽ tạo — một hàng trên bảng. NCC đầu phiếu + ngày nhận chỉ ở chế độ SỬA. */}
        <div className={`dfa-chung${taoMoi ? "" : " dfa-chung--sua"}`}>
          {!taoMoi && (
            <label className="kna-o-truong">
              <span>Nhà cung cấp <em>*</em></span>
              {/* Phiếu đã tồn tại thì thuộc MỘT nhà cung cấp. Lúc TẠO NCC gán ở từng DÒNG rồi nhóm thành N đơn. */}
              <select
                className="kna-o"
                required
                value={form.supplier_id ?? ""}
                onChange={(e) => {
                  const id = e.target.value ? Number(e.target.value) : null;
                  setForm({ ...form, supplier_id: id, lines: applySupplierPrices(form.lines, suppliers, id) });
                }}
              >
                <option value="">Chọn nhà cung cấp</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}{s.id === bestSupplierIdForLines(form.lines, suppliers) ? " (giá thấp nhất)" : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="kna-o-truong">
            <span>Ngày cần hàng <em>*</em></span>
            <ChonNgay
              className="kna-o"
              required
              min={minPurchaseDate}
              value={form.needed_date ?? ""}
              onChange={(v) => setForm({ ...form, needed_date: v })}
            />
            {/* Chỉ nhắc khi ô đã đổi khác ngày yêu cầu — trùng nhau thì ô đã nói rồi. */}
            {canNhat && taoMoi && form.needed_date !== canNhat && (
              <small className="kna-mo">Yêu cầu sớm nhất cần {ngayVN(canNhat)}</small>
            )}
          </label>
          {/* NGÀY NHẬN HÀNG CHỈ Ở CHẾ ĐỘ SỬA (chủ chốt 28/08/2026): lúc TẠO phiếu tách N đơn theo NCC
              mà ô chỉ có MỘT, đóng cùng ngày lên cả N đơn là bơm số sai vào đường cung của kế hoạch vật tư. */}
          {!taoMoi && (
            <label className="kna-o-truong">
              <span>Dự kiến nhận hàng</span>
              <ChonNgay
                className="kna-o"
                min={expectedReceiptMinDate}
                value={form.expected_receipt_date ?? ""}
                onChange={(v) => setForm({ ...form, expected_receipt_date: v })}
              />
            </label>
          )}
          <label className="kna-o-truong">
            <span>Nội dung, mục đích <em>*</em></span>
            <input
              className="kna-o"
              required
              value={form.content ?? ""}
              onChange={(e) => setForm({ ...form, content: e.target.value })}
              placeholder="VD: mua giấy cho đơn hàng ĐH-2026-031"
            />
          </label>
        </div>

        <div className="lds-bang lds-bang--nhap dfa-bang">
          <table className="lds-g dfa-g" style={{ minWidth: taoMoi ? 900 : 700 }}>
            <colgroup>
              <col />
              {taoMoi && <col style={{ width: 230 }} />}
              <col style={{ width: 128 }} />
              <col style={{ width: 156 }} />
              <col style={{ width: 80 }} />
              <col style={{ width: 116 }} />
              <col style={{ width: 44 }} />
            </colgroup>
            <thead>
              <tr>
                <th>Vật tư</th>
                {taoMoi && <th>Nhà cung cấp</th>}
                <th className="n">Số lượng</th>
                <th className="n">Đơn giá</th>
                <th className="n">VAT</th>
                <th className="n">Thành tiền</th>
                <th aria-label="Tuỳ chọn dòng" />
              </tr>
            </thead>
            <tbody>{thuTu.current.flatMap((i) => dongBang(i))}</tbody>
          </table>
        </div>
      </form>
    </NganPhai>
  );
}
