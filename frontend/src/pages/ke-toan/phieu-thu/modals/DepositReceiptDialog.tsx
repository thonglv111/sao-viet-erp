// Form LẬP PHIẾU THU CỌC của một đơn bán — mở từ ngăn Đơn hàng bán (06/10/2026).
// Kế thừa nguyên form Lập phiếu thu khác (`OtherReceiptDialog`): cùng vỏ `KhungFormPhieu`, cùng ô,
// cùng nhóm "Nhận bằng", cùng tờ 01-TT xem trước. Phần riêng của cọc: dải Cọc quy định / Đã thu /
// Còn thiếu; số tiền điền sẵn phần còn thiếu (nút "Thu đủ"); người nộp và lý do điền sẵn từ đơn.
// Gửi qua `POST /api/orders/{id}/deposit-receipts` (cổng đủ cọc + tự xuống sản xuất nằm ở đó).
//
// Kiểu khối mới (06/10/2026, như ngăn Thu tiền hoá đơn): "Cọc của đơn" (hàng đối chiếu) → "Tiền thu"
// (ô tiền lớn + "Thu đủ" + dải sau phiếu này) → "Người nộp" (chip tên khách và danh bạ liên hệ) →
// "Chứng từ". Thu dư phần còn thiếu vẫn được (máy chủ nhận), chỉ nói rõ dư bao nhiêu.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ApiError,
  api,
  type CustomerContact,
  type OrderDetail,
  type PaymentReceiptInput,
  type PaymentVoucherType,
} from "../../../../api/client";
import { useAuth } from "../../../../auth/useAuth";
import { BanXemPhieu } from "../../shared/BanXemPhieu";
import { tien, vietSo } from "../../shared/dinhDang";
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
import { vietSdt } from "../../shared/oCongNo";
import { OChungTu, taiTepSauKhiLap } from "../../shared/tepChungTu";
import { PhanNhanBang, THU_TU_O_THU_MOI, type DatOThu } from "../components/PhanNhanBang";
import { isoToday, methodText, optional, sourceLabel } from "../shared/helpers";
import { useTaiKhoanNhan } from "../shared/taiKhoanNhan";
import "../../ke-toan.css";

export function DepositReceiptDialog({
  order,
  coTheTaiTep,
  thuTien,
  onClose,
  onSaved,
}: {
  order: Pick<
    OrderDetail,
    "id" | "order_no" | "customer_id" | "customer_name" | "deposit_pct" | "deposit_required" | "deposit_received"
  >;
  /** Được tải chứng từ gốc lên phiếu thu (`phieu_thu.create`) — không có thì ẩn ô ảnh chứng từ. */
  coTheTaiTep: boolean;
  /** Đơn thương mại: chặng "Thu tiền" thu theo cả đơn, không theo cọc (docs/design-hang-thuong-mai-ha-phuong.md
   *  §6). `tong` = tổng đơn gồm VAT, `daThu` = tiền khách đã đưa cho đơn. Máy chủ chặn thu vượt phần còn thiếu. */
  thuTien?: { tong: number; daThu: number };
  onClose: () => void;
  /** Lập xong — đơn mới (đã cộng cọc); `canhBao` = phiếu đã lập nhưng chứng từ tải hỏng. */
  onSaved: (d: OrderDetail, canhBao?: string) => void;
}) {
  const { token } = useAuth();
  const conThieu = thuTien
    ? Math.max(0, thuTien.tong - thuTien.daThu)
    : Math.max(0, order.deposit_required - order.deposit_received);
  const [form, setForm] = useState<PaymentReceiptInput>(() => ({
    payer_name: order.customer_name ?? "",
    payer_address: null,
    receipt_method: "cash",
    receipt_date: isoToday(),
    amount: conThieu,
    exchange_rate: 1,
    content: `${thuTien ? "Thu tiền" : "Thu cọc"} đơn ${order.order_no}`,
    debit_account: null,
    credit_account: null,
    company_bank_account_id: null,
    bank_reference: null,
    note: null,
  }));
  const goc = useRef(JSON.stringify(form));
  const { taiKhoan, dangTai, loiTai } = useTaiKhoanNhan("VND");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loi, setLoi] = useState<LoiForm>({});
  // Danh bạ liên hệ của khách cho chip người nộp — không có quyền xem / tải hỏng thì chỉ còn chip tên khách.
  const [lienHe, setLienHe] = useState<CustomerContact[]>([]);
  useEffect(() => {
    if (!token || !order.customer_id) return;
    let song = true;
    api.customers
      .contacts(token, order.customer_id)
      .then((r) => song && setLienHe(r.items ?? []))
      .catch(() => song && setLienHe([]));
    return () => {
      song = false;
    };
  }, [token, order.customer_id]);
  const [files, setFiles] = useState<File[]>([]);
  const [loiTep, setLoiTep] = useState<string | null>(null);
  const isBank = form.receipt_method === "bank_transfer";

  const set: DatOThu = (key, value) => {
    setForm((cu) => ({ ...cu, [key]: value }));
    setLoi((l) => (l[key] ? { ...l, [key]: undefined } : l));
  };

  function chonCach(type: PaymentVoucherType) {
    setForm((cu) => ({
      ...cu,
      receipt_method: type,
      ...(type === "cash" ? { company_bank_account_id: null, bank_reference: null } : {}),
    }));
    setLoi({});
  }

  function kiemTra(): LoiForm {
    const l: LoiForm = {};
    if (!form.payer_name.trim()) l.payer_name = "Ghi người hoặc đơn vị nộp tiền.";
    if (!Number.isFinite(form.amount) || form.amount <= 0) l.amount = "Số tiền thu phải lớn hơn 0.";
    else if (thuTien && form.amount > conThieu) l.amount = `Đơn chỉ còn thiếu ${vietSo(conThieu)} đ.`;
    if (!form.content.trim()) l.content = "Ghi lý do nộp.";
    const loiNgay = loiNgayPhieu(form.receipt_date, "Ngày thu");
    if (loiNgay) l.receipt_date = loiNgay;
    if (isBank && !form.company_bank_account_id) l.company_bank_account_id = "Chọn tài khoản công ty nhận tiền.";
    if (isBank && !optional(form.bank_reference)) {
      l.bank_reference = "Thu qua ngân hàng phải có mã giao dịch hoặc số báo có.";
    }
    return l;
  }

  async function submit() {
    if (!token || saving) return;
    const l = kiemTra();
    setLoi(l);
    if (Object.values(l).some(Boolean)) {
      nhayToiLoi(l, THU_TU_O_THU_MOI);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const d = await api.orders.addDepositReceipt(token, order.id, {
        receipt_method: form.receipt_method,
        amount: Math.round(form.amount),
        receipt_date: form.receipt_date,
        payer_name: form.payer_name.trim(),
        payer_address: optional(form.payer_address),
        content: form.content.trim(),
        company_bank_account_id: isBank ? form.company_bank_account_id ?? null : null,
        bank_reference: isBank ? optional(form.bank_reference) : null,
        note: optional(form.note),
      });
      let canhBao: string | undefined;
      if (files.length && d.phieu_vua_lap_id) {
        const maPhieu = d.deposits.find((p) => p.id === d.phieu_vua_lap_id)?.code ?? "phiếu thu cọc";
        canhBao = (await taiTepSauKhiLap(maPhieu, files, (f) =>
          api.accounting.uploadReceiptAttachment(token, d.phieu_vua_lap_id as number, f),
        )) ?? undefined;
      }
      onSaved(d, canhBao);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : thuTien ? "Không lập được phiếu thu." : "Không lập được phiếu thu cọc.");
      setSaving(false);
    }
  }

  const du = (form.amount || 0) - conThieu;
  const goiY = [
    ...(order.customer_name ? [{ ten: order.customer_name, nhan: "Tên khách" }] : []),
    ...lienHe
      .slice()
      .sort((a, b) => Number(b.is_primary) - Number(a.is_primary))
      .map((c) => ({
        ten: c.name,
        phu: c.is_primary ? `liên hệ chính${c.phone ? ` ${vietSdt(c.phone)}` : ""}` : undefined,
      })),
  ];
  const tk = taiKhoan.find((t) => t.id === form.company_bank_account_id);

  return createPortal(
    <KhungFormPhieu
      duongDan={`Đơn hàng bán > ${order.order_no}`}
      tieuDe={thuTien ? "Lập phiếu thu" : "Lập phiếu thu cọc"}
      tang={1}
      phuDe={
        <>
          <span className="kt-tag">
            Đơn <b>{order.order_no}</b>
          </span>
          {order.customer_name && (
            <span className="kt-tag">
              Khách <b>{order.customer_name}</b>
            </span>
          )}
        </>
      }
      xemTruoc="Lập xong là đã thu tiền, không sửa được, chỉ hủy được."
      dangLuu={saving}
      loiChung={error}
      onDong={onClose}
      chanDong={() => JSON.stringify(form) !== goc.current || files.length > 0}
      onSubmit={() => void submit()}
      nhanNut="Lập phiếu thu"
      banXem={
        <BanXemPhieu
          kind="thu"
          ngay={form.receipt_date}
          nguoi={form.payer_name}
          diaChi={optional(form.payer_address)}
          lyDo={form.content}
          dongPhu={[
            { label: "Hình thức", value: methodText(form) },
            ...(isBank
              ? [{ label: "Tài khoản nhận", value: tk ? `${tk.account_number} tại ${tk.bank_name}` : "" }]
              : []),
            { label: "Nguồn thu", value: `${sourceLabel({ source_type: "order_deposit" })} ${order.order_no}` },
            ...(isBank && optional(form.bank_reference) ? [{ label: "Mã giao dịch", value: form.bank_reference ?? "" }] : []),
          ]}
          soTien={form.amount}
          soChungTu={files.length}
        />
      }
    >
      <KhoiForm tieu={thuTien ? "Tiền của đơn" : "Cọc của đơn"}>
        <HangDoiChieu
          o={thuTien ? [
            { nhan: "Tổng đơn gồm VAT", giaTri: tien(thuTien.tong) },
            { nhan: "Đã thu", giaTri: tien(thuTien.daThu) },
            { nhan: "Còn thiếu", giaTri: tien(conThieu), chot: true },
          ] : [
            { nhan: `Cọc quy định${order.deposit_pct != null ? ` (${order.deposit_pct}%)` : ""}`, giaTri: tien(order.deposit_required) },
            { nhan: "Đã thu", giaTri: tien(order.deposit_received) },
            { nhan: "Còn thiếu", giaTri: tien(conThieu), chot: true },
          ]}
        />
      </KhoiForm>

      <KhoiForm tieu="Tiền thu">
        <OTienLon khoa="amount" nhan="Số tiền thu" value={form.amount} onChange={(v) => set("amount", v)} loi={loi.amount}
          nutDu={{ nhan: "Thu đủ", so: conThieu }} goiTrong={thuTien ? "Nhập số tiền khách trả" : "Nhập số tiền khách nộp cọc"}
          con={
            <>
              <SauPhieu o={[{ nhan: thuTien ? "Đơn còn thiếu" : "Cọc còn thiếu", tu: conThieu, den: conThieu - (form.amount || 0) }]} />
              {!thuTien && conThieu > 0 && du > 0 && (
                <p className="kt-khac">{`Thu dư ${vietSo(du)} đ so với phần cọc còn thiếu.`}</p>
              )}
            </>
          } />
        <PhanNhanBang form={form} set={set} loi={loi} onDoiCach={chonCach} taiKhoan={taiKhoan}
          dangTai={dangTai} loiTai={loiTai} tienTe="VND" gon
          oNgay={
            <ONgayPhieu khoa="receipt_date" nhan="Ngày thu" value={form.receipt_date}
              onChange={(v) => set("receipt_date", v)} loi={loi.receipt_date} />
          } />
      </KhoiForm>

      <KhoiForm tieu="Người nộp">
        <OF khoa="payer_name" nhan="Người nộp tiền" batBuoc rong loi={loi.payer_name}>
          <input id={idO("payer_name")} value={form.payer_name} placeholder="Người hoặc đơn vị nộp tiền"
            aria-invalid={loi.payer_name ? true : undefined}
            onChange={(e) => set("payer_name", e.target.value)} />
        </OF>
        {goiY.length > 1 && (
          <GoiYTen goiY={goiY} dangChon={form.payer_name} onChon={(t) => set("payer_name", t)} nhan="Gợi ý người nộp tiền" />
        )}
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
        {coTheTaiTep && (
          <OChungTu files={files} setFiles={setFiles} loi={loiTep ?? undefined} onLoi={setLoiTep}
            goi={'Biên nhận, ảnh chụp sao kê. Số ảnh in thành "Kèm theo" trên phiếu.'} />
        )}
        <OF khoa="note" nhan="Ghi chú nội bộ" rong goi="Không in lên phiếu">
          <textarea id={idO("note")} value={form.note ?? ""} onChange={(e) => set("note", e.target.value)} />
        </OF>
      </KhoiForm>
    </KhungFormPhieu>,
    document.body,
  );
}
