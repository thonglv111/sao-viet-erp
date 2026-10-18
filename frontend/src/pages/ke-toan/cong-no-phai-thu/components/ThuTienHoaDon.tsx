// Ngăn chồng THU TIỀN một hoá đơn (đặc tả NPTh-3; kiểu mới 06/10/2026 theo
// docs/mockups/thu-tien-ngan-chong-phuong-an-3-ban-2.html). Mở trên ngăn khách hàng (`tang=1`): Esc chỉ
// đóng lớp này, ngăn khách bên dưới vẫn mở. Thay khung thu cũ mở ngay dưới dòng hoá đơn — khung đó
// bị bóp trong bảng, không cuộn được.
//
// Trái, theo thứ tự kế toán cần nhìn: "Hoá đơn này" (giá trị | trừ cọc | đã thu | còn phải thu, các lần
// thu trước của chính hoá đơn này, hoá đơn khác của khách còn nợ) → "Tiền thu" (ô tiền lớn + bằng chữ +
// "Thu đủ", dải "sau phiếu này", ngày thu, nhận bằng) → "Người nộp" (gợi ý từ tên khách và danh bạ liên
// hệ) → "Chứng từ". Phải: tờ 01-TT khổ A5 đổi theo từng phím gõ.
//
// ⚠️ TIỀN THẬT: luật kiểm và các trường của payload GIỮ Y khung cũ (`InvoiceReceiptForm`); thêm
// `payer_address` (máy chủ nhận từ trước) và tải chứng từ lên NGAY SAU khi lập, như form Thu khác.
// Thu quá số còn phải thu: báo đỏ tại ô và khoá nút lập (máy chủ cũng chặn).
import { ChevronRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  ApiError,
  api,
  type CustomerContact,
  type PaymentReceiptInput,
  type PaymentReceiptRow,
  type PaymentVoucherType,
  type ReceivableItemRow,
  type ReceivablesDetail,
} from "../../../../api/client";
import { useAuth } from "../../../../auth/useAuth";
import { money } from "../../../../utils/format";
import { homNayVN, soNgay } from "../../../../utils/ky";
import { PhanNhanBang, type DatOThu } from "../../phieu-thu/components/PhanNhanBang";
import { METHOD_LABELS } from "../../phieu-thu/shared/constants";
import { methodText, optional } from "../../phieu-thu/shared/helpers";
import { useTaiKhoanNhan } from "../../phieu-thu/shared/taiKhoanNhan";
import { BanXemPhieu } from "../../shared/BanXemPhieu";
import { ngay, vietSo } from "../../shared/dinhDang";
import {
  GoiYTen,
  HangDoiChieu,
  KhoiForm,
  KhungFormPhieu,
  OF,
  ONgayPhieu,
  OTienLon,
  SauPhieu,
  idO,
  loiNgayPhieu,
  nhayToiLoi,
  type LoiForm,
} from "../../shared/KhungFormPhieu";
import { useDongNgan } from "../../shared/NganPhai";
import { vietSdt } from "../../shared/oCongNo";
import { OChungTu, taiTepSauKhiLap } from "../../shared/tepChungTu";

/** Thứ tự ô trên form — con trỏ nhảy tới ô sai đầu tiên theo đúng thứ tự này. */
const THU_TU = ["amount", "receipt_date", "company_bank_account_id", "bank_reference", "payer_name", "content"];

/** "Hạn thu 05/11/2026 còn 30 ngày" — thẻ đầu ngăn; trễ thì thẻ đỏ. */
function TheHan({ item }: { item: ReceivableItemRow }) {
  if (item.chua_dat_han || !item.due_date) return <span className="kt-tag">Chưa đặt hạn thu</span>;
  const d = soNgay(homNayVN(), item.due_date);
  return (
    <span className={d < 0 ? "kt-tag kt-tag--do" : "kt-tag"}>
      Hạn thu <b>{ngay(item.due_date)}</b>
      {d > 0 ? `còn ${vietSo(d)} ngày` : d < 0 ? `trễ ${vietSo(-d)} ngày` : "tới hạn hôm nay"}
    </span>
  );
}

/** Nút "Xem ở ngăn khách" — đóng lớp này qua đúng đường đóng (gõ dở thì hỏi trước). */
function NutVeNganKhach() {
  const dong = useDongNgan();
  return (
    <button type="button" className="kt-lk" onClick={dong}>
      Xem ở ngăn khách
    </button>
  );
}

export function ThuTienHoaDon({
  item,
  customerId,
  customerName,
  onDong,
  onDaLap,
  onMoDon,
  onMoPhieu,
  onMoTaiKhoan,
  coNganKhach = true,
}: {
  item: ReceivableItemRow;
  customerId: number;
  customerName: string;
  onDong: () => void;
  /** Lập xong (kể cả khi chứng từ tải hỏng — phiếu VẪN đã lập). */
  onDaLap: (receipt: PaymentReceiptRow) => void;
  onMoDon?: (orderId: number) => void;
  onMoPhieu?: (code: string) => void;
  onMoTaiKhoan?: () => void;
  /** Mở từ ngăn khách (Công nợ phải thu) — có nút "Xem ở ngăn khách". Màn Phiếu thu mở thẳng thì không. */
  coNganKhach?: boolean;
}) {
  const { token } = useAuth();
  const conNo = item.remaining_amount;
  const [form, setForm] = useState<PaymentReceiptInput>(() => ({
    payer_name: customerName,
    payer_address: null,
    receipt_method: "cash",
    receipt_date: homNayVN(),
    amount: conNo,
    exchange_rate: 1,
    content: `Thu hóa đơn ${item.invoice_number} của đơn ${item.order_code}`,
    company_bank_account_id: null,
    bank_reference: null,
    note: null,
  }));
  const goc = useRef(JSON.stringify(form));
  const { taiKhoan, dangTai: dangTaiTk, loiTai: loiTaiTk } = useTaiKhoanNhan("VND");
  const [dangLap, setDangLap] = useState(false);
  const [loiChung, setLoiChung] = useState<string | null>(null);
  const [loi, setLoi] = useState<LoiForm>({});
  const [files, setFiles] = useState<File[]>([]);
  const [loiTep, setLoiTep] = useState<string | null>(null);
  const [daLap, setDaLap] = useState<PaymentReceiptRow | null>(null);
  const isBank = form.receipt_method === "bank_transfer";

  // Bối cảnh của khách: CẢ lịch sử thu (để lọc các lần thu của chính hoá đơn này — rổ "đã thu" của ngăn
  // khách chỉ là một kỳ, một trang) và danh bạ liên hệ. Tải hỏng thì khối đó im, form vẫn lập được.
  const [ct, setCt] = useState<ReceivablesDetail | null>(null);
  const [loiCt, setLoiCt] = useState(false);
  const [lienHe, setLienHe] = useState<CustomerContact[]>([]);
  useEffect(() => {
    if (!token) return;
    let song = true;
    api.accounting
      .receivablesDetail(token, customerId, true)
      .then((d) => song && setCt(d))
      .catch(() => song && setLoiCt(true));
    api.customers
      .contacts(token, customerId)
      .then((r) => song && setLienHe(r.items ?? []))
      .catch(() => song && setLienHe([]));
    return () => {
      song = false;
    };
  }, [token, customerId]);

  const lanTruoc = useMemo(
    () => (ct?.paid ?? []).filter((p) => p.sales_invoice_id === item.invoice_id),
    [ct, item.invoice_id],
  );
  const hdKhac = useMemo(
    () => (ct?.items ?? []).filter((x) => x.invoice_id !== item.invoice_id && x.remaining_amount > 0),
    [ct, item.invoice_id],
  );

  const set: DatOThu = (key, value) => {
    setForm((cu) => ({ ...cu, [key]: value }));
    setLoi((l) => (l[key] ? { ...l, [key]: undefined } : l));
  };

  function chonCach(type: PaymentVoucherType) {
    // Về tiền mặt thì bỏ tài khoản và mã giao dịch đã chọn (payload cũng gửi null cho tiền mặt).
    setForm((cu) => ({
      ...cu,
      receipt_method: type,
      ...(type === "cash" ? { company_bank_account_id: null, bank_reference: null } : {}),
    }));
    setLoi({});
  }

  const vuot = form.amount > conNo ? form.amount - conNo : 0;

  function kiemTra(): LoiForm {
    const l: LoiForm = {};
    if (!Number.isFinite(form.amount) || form.amount <= 0 || form.amount > conNo) {
      l.amount = `Số tiền thu phải từ 1 đến ${money(conNo)}.`;
    }
    const loiNgay = loiNgayPhieu(form.receipt_date, "Ngày thu");
    if (loiNgay) l.receipt_date = loiNgay;
    else if (form.receipt_date < item.invoice_date) {
      l.receipt_date = `Ngày thu không được trước ngày hoá đơn ${ngay(item.invoice_date)}.`;
    }
    if (isBank && !form.company_bank_account_id) l.company_bank_account_id = "Chọn tài khoản công ty nhận tiền.";
    if (isBank && !optional(form.bank_reference)) {
      l.bank_reference = "Nhập mã giao dịch ngân hàng in trên sao kê hoặc tin nhắn báo có.";
    }
    if (!form.payer_name.trim()) l.payer_name = "Ghi người nộp tiền.";
    if (!form.content.trim()) l.content = "Ghi lý do nộp.";
    return l;
  }

  async function lap() {
    if (!token || dangLap) return;
    if (daLap) {
      onDaLap(daLap);
      return;
    }
    const l = kiemTra();
    setLoi(l);
    if (Object.values(l).some(Boolean)) {
      window.setTimeout(() => nhayToiLoi(l, THU_TU), 0);
      return;
    }
    const payload: PaymentReceiptInput = {
      payer_name: form.payer_name.trim(),
      payer_address: optional(form.payer_address),
      receipt_method: form.receipt_method,
      receipt_date: form.receipt_date,
      amount: Math.round(form.amount),
      exchange_rate: 1,
      content: form.content.trim(),
      company_bank_account_id: isBank ? form.company_bank_account_id ?? null : null,
      bank_reference: isBank ? optional(form.bank_reference) : null,
      note: optional(form.note),
    };
    setDangLap(true);
    setLoiChung(null);
    try {
      const saved = await api.accounting.createSalesInvoiceReceipt(token, item.invoice_id, payload);
      if (files.length) {
        const hong = await taiTepSauKhiLap(saved.code, files, (f) =>
          api.accounting.uploadReceiptAttachment(token, saved.id, f),
        );
        if (hong) {
          setDaLap(saved);
          setLoiChung(hong);
          setDangLap(false);
          return;
        }
      }
      onDaLap(saved);
    } catch (err) {
      setLoiChung(err instanceof ApiError ? err.message : "Không lập được phiếu thu hoá đơn.");
      setDangLap(false);
    }
  }

  // Sau phiếu này — đổi theo từng phím gõ. Phần thu vượt không được tính (phiếu đó không lập được).
  const thuThat = Math.min(Math.max(0, form.amount), conNo);
  const khachNo = ct?.total_due;
  const hanMuc = ct?.credit_limit ?? 0;
  const sau = [
    { nhan: "Hoá đơn còn nợ", tu: conNo, den: conNo - thuThat },
    ...(khachNo != null ? [{ nhan: "Khách còn nợ", tu: khachNo, den: khachNo - thuThat }] : []),
    ...(khachNo != null && hanMuc > 0 ? [{ nhan: "Hạn mức còn được nợ", den: hanMuc - (khachNo - thuThat) }] : []),
  ];

  const goiY = [
    { ten: customerName, nhan: "Tên khách" },
    ...lienHe
      .slice()
      .sort((a, b) => Number(b.is_primary) - Number(a.is_primary))
      .map((c) => ({
        ten: c.name,
        phu: c.is_primary ? `liên hệ chính${c.phone ? ` ${vietSdt(c.phone)}` : ""}` : undefined,
      })),
  ];

  const tk = taiKhoan.find((t) => t.id === form.company_bank_account_id);
  const soHd = item.invoice_symbol ? `${item.invoice_symbol} ${item.invoice_number}` : item.invoice_number;

  return (
    <KhungFormPhieu
      tang={1}
      duongDan={
        <>
          {customerName}
          <ChevronRight size={14} aria-hidden="true" />
          {`Hoá đơn ${item.invoice_number}`}
        </>
      }
      tieuDe={`Thu tiền hoá đơn ${item.invoice_number}`}
      phuDe={
        <>
          <span className="kt-tag">
            Ngày hoá đơn <b>{ngay(item.invoice_date)}</b>
          </span>
          {item.invoice_symbol && (
            <span className="kt-tag">
              Ký hiệu <b>{item.invoice_symbol}</b>
            </span>
          )}
          <span className="kt-tag">
            Đơn{" "}
            <b>
              {onMoDon ? (
                <button type="button" className="kt-lk" onClick={() => onMoDon(item.order_id)}>{item.order_code}</button>
              ) : (
                item.order_code
              )}
            </b>
          </span>
          <TheHan item={item} />
        </>
      }
      xemTruoc={daLap ? <>Phiếu <b>{daLap.code}</b> đã lập.</> : "Lập xong không sửa được, chỉ hủy được."}
      dangLuu={dangLap}
      loiChung={loiChung}
      onDong={() => (daLap ? onDaLap(daLap) : onDong())}
      chanDong={() => !daLap && (JSON.stringify(form) !== goc.current || files.length > 0)}
      onSubmit={() => void lap()}
      nhanNut={daLap ? "Xong" : "Lập phiếu thu"}
      khoaNut={!daLap && vuot > 0}
      banXem={
        <BanXemPhieu
          kind="thu"
          ngay={form.receipt_date}
          nguoi={form.payer_name}
          diaChi={optional(form.payer_address)}
          lyDo={form.content}
          dongPhu={[
            { label: "Nguồn thu", value: `Thu hoá đơn ${soHd}` },
            { label: "Hình thức", value: methodText(form) },
            ...(isBank
              ? [
                  { label: "Tài khoản nhận", value: tk ? `${tk.account_number} tại ${tk.bank_name}` : "" },
                  { label: "Mã giao dịch", value: form.bank_reference ?? "" },
                ]
              : []),
          ]}
          soTien={vuot > 0 ? 0 : form.amount}
          soChungTu={files.length}
        />
      }
    >
      <KhoiForm tieu="Hoá đơn này">
        <HangDoiChieu
          o={[
            { nhan: "Giá trị hoá đơn", giaTri: vietSo(item.amount) },
            // Trả lại khách ngoài đơn cộng nợ lại vào hoá đơn (17/10/2026): đứng riêng để Đã thu là số thật.
            ...((item.hoan_khong_don ?? 0) > 0
              ? [{ nhan: "Trả lại khách ngoài đơn", giaTri: vietSo(item.hoan_khong_don ?? 0) }]
              : []),
            { nhan: "Trừ cọc", giaTri: vietSo(item.deposit_offset_amount) },
            { nhan: "Đã thu", giaTri: vietSo(item.direct_received_amount) },
            { nhan: "Còn phải thu", giaTri: vietSo(conNo), chot: true },
          ]}
        />
        {lanTruoc.length > 0 && (
          <div className="lds-bang">
            <table className="lds-g" style={{ minWidth: 520 }} aria-label="Các lần thu trước của hoá đơn này">
              <colgroup>
                <col style={{ width: 120 }} />
                <col style={{ width: 96 }} />
                <col style={{ width: 120 }} />
                <col />
                <col style={{ width: 112 }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Phiếu thu</th>
                  <th>Ngày thu</th>
                  <th>Hình thức</th>
                  <th>Người lập</th>
                  <th className="n">Số tiền</th>
                </tr>
              </thead>
              <tbody>
                {lanTruoc.map((p) => (
                  <tr key={p.receipt_id}>
                    <td>
                      {onMoPhieu ? (
                        <button type="button" className="kt-lk" onClick={() => onMoPhieu(p.code)}>{p.code}</button>
                      ) : (
                        p.code
                      )}
                      {(p.so_dong ?? 1) > 1 && p.receipt_amount != null && (
                        <span className="lds-mu" title="Một phiếu thu nhiều khoản, Số tiền là phần của hoá đơn này">
                          {` phiếu gộp ${vietSo(p.receipt_amount)}`}
                        </span>
                      )}
                    </td>
                    <td>{ngay(p.receipt_date)}</td>
                    <td>{METHOD_LABELS[p.receipt_method] ?? p.receipt_method}</td>
                    <td>{p.created_by_name ?? "—"}</td>
                    <td className="n">{vietSo(p.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {ct && (
          <p className="kt-khac">
            {hdKhac.length === 0 ? (
              "Khách không còn hoá đơn nào khác chưa thu."
            ) : (
              <>
                Khách còn nợ hoá đơn khác:
                {hdKhac.map((x) => (
                  <span key={x.invoice_id} className={x.overdue_days > 0 ? "kt-tag kt-tag--do" : "kt-tag"}>
                    {`HĐ ${x.invoice_number}`} <b>{vietSo(x.remaining_amount)}</b>
                    {x.overdue_days > 0 ? `trễ ${vietSo(x.overdue_days)} ngày` : null}
                  </span>
                ))}
                {coNganKhach && <NutVeNganKhach />}
              </>
            )}
          </p>
        )}
        {loiCt && <p className="kt-khac">Chưa đọc được các lần thu trước và hoá đơn khác của khách.</p>}
      </KhoiForm>

      <KhoiForm tieu="Tiền thu">
        <OTienLon khoa="amount" nhan="Số tiền thu" value={form.amount} onChange={(v) => set("amount", v)} loi={loi.amount}
          nutDu={{ nhan: "Thu đủ", so: conNo }} goiTrong="Nhập số tiền khách nộp"
          vuot={vuot > 0 ? `Thu quá số còn phải thu ${vietSo(vuot)} đ. Phiếu thu một hoá đơn không được vượt số còn nợ.` : null}
          con={<SauPhieu o={sau} />} />
        <PhanNhanBang form={form} set={set} loi={loi} onDoiCach={chonCach} taiKhoan={taiKhoan} dangTai={dangTaiTk}
          loiTai={loiTaiTk} tienTe="VND" onMoTaiKhoan={onMoTaiKhoan} nutThemTaiKhoan gon
          oNgay={
            <ONgayPhieu khoa="receipt_date" nhan="Ngày thu" goi={`Từ ngày hoá đơn ${ngay(item.invoice_date)} tới hôm nay`}
              min={item.invoice_date} value={form.receipt_date} onChange={(v) => set("receipt_date", v)}
              loi={loi.receipt_date} />
          } />
      </KhoiForm>

      <KhoiForm tieu="Người nộp">
        <OF khoa="payer_name" nhan="Người nộp tiền" batBuoc rong loi={loi.payer_name}>
          <input id={idO("payer_name")} value={form.payer_name} aria-invalid={loi.payer_name ? true : undefined}
            onChange={(e) => set("payer_name", e.target.value)} />
        </OF>
        <GoiYTen goiY={goiY} dangChon={form.payer_name} onChon={(t) => set("payer_name", t)} nhan="Gợi ý người nộp tiền" />
        <OF khoa="content" nhan="Lý do nộp" batBuoc rong loi={loi.content}>
          <input id={idO("content")} value={form.content} aria-invalid={loi.content ? true : undefined}
            onChange={(e) => set("content", e.target.value)} />
        </OF>
        <OF khoa="payer_address" nhan="Địa chỉ người nộp" rong>
          <input id={idO("payer_address")} maxLength={500} value={form.payer_address ?? ""}
            placeholder="Không bắt buộc. Có thì in lên phiếu"
            onChange={(e) => set("payer_address", e.target.value)} />
        </OF>
      </KhoiForm>

      <KhoiForm tieu="Chứng từ">
        <OChungTu files={files} setFiles={setFiles} loi={loiTep ?? undefined} onLoi={setLoiTep}
          goi={'Biên nhận, ảnh chụp sao kê. Số ảnh in thành "Kèm theo" trên phiếu.'} />
        <OF khoa="note" nhan="Ghi chú nội bộ" rong goi="Không in lên phiếu">
          <textarea id={idO("note")} value={form.note ?? ""} placeholder="VD: Khách hẹn chuyển nốt phần còn lại tuần sau"
            onChange={(e) => set("note", e.target.value)} />
        </OF>
      </KhoiForm>
    </KhungFormPhieu>
  );
}
