// Ngăn chồng LẬP MỘT PHIẾU THU cho NHIỀU khoản của CÙNG một khách (chủ chốt 17/10/2026: "một phiếu
// cho cả lượt") — cọc của đơn, hoá đơn, của một hay nhiều đơn bán. Cùng khuôn `LapPhieuChiGop` bên chi.
//
// Một số phiếu thu, bên trong là bảng "Các khoản trong phiếu": mỗi khoản một ô "Thu lần này" điền sẵn
// bằng phần còn phải thu, sửa được (khách trả một phần). Máy chủ kiểm lại trần từng khoản như phiếu lẻ
// và chỉ ghi khi MỌI khoản hợp lệ. Chứng từ (sao kê, biên nhận) đính MỘT lần vào chính phiếu đó.
//
// Mở từ hai chỗ: hàng "Đơn hàng chờ thu" của màn Phiếu thu và ngăn khách ở Công nợ phải thu.
import { ChevronRight, CircleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  ApiError,
  api,
  type CustomerContact,
  type PaymentReceiptInput,
  type PaymentReceiptRow,
  type PaymentVoucherType,
  type PhieuThuGopInput,
} from "../../../../api/client";
import { useAuth } from "../../../../auth/useAuth";
import { OGoDinhDang } from "../../../../components/OGoDinhDang";
import { homNayVN } from "../../../../utils/ky";
import { BanXemPhieu } from "../../shared/BanXemPhieu";
import { ngay, tien, vietSo } from "../../shared/dinhDang";
import {
  GoiYTen,
  HangDoiChieu,
  KhoiForm,
  KhungFormPhieu,
  OF,
  ONgayPhieu,
  SauPhieu,
  idO,
  loiNgayPhieu,
  nhayToiLoi,
  type LoiForm,
} from "../../shared/KhungFormPhieu";
import { vietSdt } from "../../shared/oCongNo";
import { OChungTu, taiTepSauKhiLap } from "../../shared/tepChungTu";
import { methodText, optional } from "../shared/helpers";
import { useTaiKhoanNhan } from "../shared/taiKhoanNhan";
import { PhanNhanBang, type DatOThu } from "./PhanNhanBang";

/** Một khoản đưa vào phiếu: CỌC của đơn (`sales_invoice_id` trống) hoặc một hoá đơn. `con` = trần. */
export type KhoanThuGop = {
  sales_invoice_id: number | null;
  order_id: number;
  ma_don: string;
  /** "Cọc" / "HĐ 0000123" — chữ của cột Khoản. */
  nhan: string;
  han: string | null;
  con: number;
  /** Ngày hoá đơn — ngày thu không được trước ngày này. */
  ngay_hd?: string | null;
};

const khoaKhoan = (k: KhoanThuGop) => (k.sales_invoice_id != null ? `hd-${k.sales_invoice_id}` : `coc-${k.order_id}`);

/** Thứ tự ô trên form — con trỏ nhảy tới ô sai đầu tiên. */
const THU_TU = ["khoan", "receipt_date", "company_bank_account_id", "bank_reference", "payer_name"];

export function LapPhieuThuGop({
  customerId,
  customerName,
  khoan,
  conNoKhach,
  onClose,
  onSaved,
  onMoTaiKhoan,
}: {
  customerId: number | null;
  customerName: string;
  /** ẢNH CHỤP các khoản lúc mở — ngăn dưới nạp lại cũng không đổi form đang gõ. */
  khoan: KhoanThuGop[];
  /** Tổng khách còn nợ — cho dải "sau phiếu này". */
  conNoKhach?: number | null;
  onClose: () => void;
  /** Đã lập xong (kể cả khi chứng từ tải hỏng — phiếu VẪN đã lập). */
  onSaved: (receipt: PaymentReceiptRow) => void;
  onMoTaiKhoan?: () => void;
}) {
  const { token } = useAuth();
  // Cùng hình dạng với form phiếu thu để dùng lại khối "Nhận bằng"; `amount`/`content` chỉ đủ kiểu.
  const [form, setForm] = useState<PaymentReceiptInput>(() => ({
    payer_name: customerName,
    payer_address: null,
    receipt_method: "cash",
    receipt_date: homNayVN(),
    amount: 0,
    exchange_rate: 1,
    content: "",
    company_bank_account_id: null,
    bank_reference: null,
    note: null,
  }));
  const goc = useRef(JSON.stringify(form));
  const [soThu, setSoThu] = useState<Record<string, number>>(() =>
    Object.fromEntries(khoan.map((k) => [khoaKhoan(k), k.con])),
  );
  const { taiKhoan, dangTai: dangTaiTk, loiTai: loiTaiTk } = useTaiKhoanNhan("VND");
  const [lienHe, setLienHe] = useState<CustomerContact[]>([]);
  const [loi, setLoi] = useState<LoiForm>({});
  const [loiChung, setLoiChung] = useState<string | null>(null);
  const [dangLuu, setDangLuu] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [loiTep, setLoiTep] = useState<string | null>(null);
  // Đã lập mà chứng từ tải hỏng: ở lại để người dùng đọc mã phiếu, nút chính thành "Xong".
  const [daLap, setDaLap] = useState<PaymentReceiptRow | null>(null);

  useEffect(() => {
    if (!token || customerId == null) return;
    let song = true;
    api.customers
      .contacts(token, customerId)
      .then((r) => song && setLienHe(r.items ?? []))
      .catch(() => song && setLienHe([]));
    return () => {
      song = false;
    };
  }, [token, customerId]);

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

  const n = khoan.length;
  const tong = khoan.reduce((s, k) => s + (soThu[khoaKhoan(k)] ?? 0), 0);
  const isBank = form.receipt_method === "bank_transfer";
  const sai = (k: KhoanThuGop) => {
    const v = soThu[khoaKhoan(k)] ?? 0;
    return v <= 0 || v > k.con;
  };
  // Ngày thu không trước hoá đơn muộn nhất trong phiếu (máy chủ cũng chặn từng hoá đơn).
  const ngayHdMuon = khoan.reduce<string | null>((m, k) => (k.ngay_hd && (!m || k.ngay_hd > m) ? k.ngay_hd : m), null);

  async function submit() {
    if (daLap) {
      onSaved(daLap);
      return;
    }
    if (!token || dangLuu || n === 0) return;
    const khoanSai = khoan.find(sai);
    const loiNgay = loiNgayPhieu(form.receipt_date, "Ngày thu");
    const moi: LoiForm = {
      khoan: khoanSai
        ? (soThu[khoaKhoan(khoanSai)] ?? 0) <= 0
          ? `${khoanSai.ma_don} ${khoanSai.nhan} chưa có số tiền thu.`
          : `${khoanSai.ma_don} ${khoanSai.nhan} thu quá phần còn phải thu (${tien(khoanSai.con)}).`
        : undefined,
      receipt_date:
        loiNgay ??
        (ngayHdMuon && form.receipt_date < ngayHdMuon
          ? `Ngày thu không được trước ngày hoá đơn ${ngay(ngayHdMuon)}.`
          : undefined),
      company_bank_account_id: isBank && !form.company_bank_account_id ? "Chọn tài khoản công ty nhận tiền." : undefined,
      bank_reference:
        isBank && !optional(form.bank_reference)
          ? "Nhập mã giao dịch ngân hàng in trên sao kê hoặc tin nhắn báo có."
          : undefined,
      payer_name: !form.payer_name.trim() ? "Ghi người nộp tiền." : undefined,
    };
    if (Object.values(moi).some(Boolean)) {
      setLoi(moi);
      if (moi.khoan && khoanSai) document.getElementById(idO(`khoan-${khoaKhoan(khoanSai)}`))?.focus();
      else window.setTimeout(() => nhayToiLoi(moi, THU_TU), 0);
      return;
    }

    const payload: PhieuThuGopInput = {
      lines: khoan.map((k) => ({
        sales_invoice_id: k.sales_invoice_id,
        order_id: k.order_id,
        amount: soThu[khoaKhoan(k)] ?? 0,
      })),
      payer_name: form.payer_name.trim(),
      payer_address: optional(form.payer_address),
      receipt_method: form.receipt_method,
      receipt_date: form.receipt_date,
      content: optional(form.content),
      company_bank_account_id: isBank ? (form.company_bank_account_id ?? null) : null,
      bank_reference: isBank ? optional(form.bank_reference) : null,
      note: optional(form.note),
    };
    setDangLuu(true);
    setLoiChung(null);
    try {
      const saved = await api.accounting.createReceiptGop(token, payload);
      if (files.length) {
        const hong = await taiTepSauKhiLap(saved.code, files, (f) =>
          api.accounting.uploadReceiptAttachment(token, saved.id, f),
        );
        if (hong) {
          setDaLap(saved);
          setLoiChung(hong);
          return;
        }
      }
      onSaved(saved);
    } catch (err) {
      setLoiChung(err instanceof ApiError ? err.message : "Không lập được phiếu thu.");
    } finally {
      setDangLuu(false);
    }
  }

  const goDo = () =>
    files.length > 0 || khoan.some((k) => soThu[khoaKhoan(k)] !== k.con) || JSON.stringify(form) !== goc.current;

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
  const soDon = new Set(khoan.map((k) => k.order_id)).size;
  const sau = conNoKhach != null ? [{ nhan: "Khách còn nợ", tu: conNoKhach, den: conNoKhach - tong }] : [];

  return (
    <KhungFormPhieu
      tang={1}
      duongDan={
        <>
          {customerName}
          <ChevronRight size={14} aria-hidden="true" />
          {`Thu ${n} khoản`}
        </>
      }
      tieuDe={`Lập phiếu thu ${n} khoản`}
      phuDe={<span className="kt-tag">{`Khách hàng ${customerName}`}</span>}
      xemTruoc={daLap ? `Phiếu ${daLap.code} đã lập.` : "Lập xong không sửa được, chỉ hủy được."}
      dangLuu={dangLuu}
      loiChung={loiChung}
      onDong={() => (daLap ? onSaved(daLap) : onClose())}
      chanDong={() => !daLap && goDo()}
      onSubmit={() => void submit()}
      nhanNut={daLap ? "Xong" : "Lập phiếu thu"}
      khoaNut={!daLap && n === 0}
      banXem={
        <BanXemPhieu
          kind="thu"
          ngay={form.receipt_date}
          nguoi={form.payer_name}
          diaChi={optional(form.payer_address)}
          lyDo={optional(form.content) ?? `Thu ${khoan.map((k) => `${k.nhan} ${k.ma_don}`).join(", ")}`}
          dongPhu={[
            { label: "Nguồn thu", value: `${vietSo(n)} khoản của ${vietSo(soDon)} đơn` },
            { label: "Hình thức", value: methodText(form) },
            ...(isBank
              ? [
                  { label: "Tài khoản nhận", value: tk ? `${tk.account_number} tại ${tk.bank_name}` : "" },
                  { label: "Mã giao dịch", value: form.bank_reference ?? "" },
                ]
              : []),
          ]}
          soTien={tong}
          soChungTu={files.length}
        />
      }
    >
      <KhoiForm tieu="Các khoản trong phiếu">
        <HangDoiChieu
          o={[
            { nhan: "Số khoản", giaTri: vietSo(n) },
            { nhan: "Số đơn bán", giaTri: vietSo(soDon) },
            { nhan: "Tổng phiếu", giaTri: tien(tong), chot: true },
          ]}
        />
        <div className="lds-bang kt-gop-bang">
          <table className="lds-g" style={{ minWidth: 560 }} aria-label="Các khoản trong phiếu">
            <colgroup>
              <col style={{ width: 120 }} />
              <col style={{ width: 110 }} />
              <col style={{ width: 100 }} />
              <col style={{ width: 120 }} />
              <col />
            </colgroup>
            <thead>
              <tr>
                <th>Đơn bán</th>
                <th>Khoản</th>
                <th>Hạn thu</th>
                <th className="n">Còn</th>
                <th className="n">Thu lần này</th>
              </tr>
            </thead>
            <tbody>
              {khoan.map((k) => {
                const khoa = khoaKhoan(k);
                const v = soThu[khoa] ?? 0;
                return (
                  <tr key={khoa}>
                    <td>{k.ma_don}</td>
                    <td>{k.nhan}</td>
                    <td>{k.han ? ngay(k.han) : ""}</td>
                    <td className="n">{vietSo(k.con)}</td>
                    <td className="n">
                      <div className="kt-o-tien kt-o-tien--nho kt-gop-o">
                        <OGoDinhDang id={idO(`khoan-${khoa}`)} type="text" inputMode="numeric" placeholder="0"
                          aria-label={`Thu lần này ${k.ma_don} ${k.nhan}`} aria-invalid={sai(k) || undefined}
                          value={v ? v.toLocaleString("vi-VN") : ""}
                          onChange={(e) => {
                            const so = e.target.value.replace(/\D/g, "");
                            setSoThu((cu) => ({ ...cu, [khoa]: so ? Number(so) : 0 }));
                            setLoi((l) => (l.khoan ? { ...l, khoan: undefined } : l));
                          }} />
                        <span>đ</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {loi.khoan ? (
          <p className="kt-o__loi" role="alert">
            <CircleAlert size={14} aria-hidden="true" />
            {loi.khoan}
          </p>
        ) : (
          <p className="kt-khac">Mỗi khoản điền sẵn phần còn phải thu. Sửa số khi khách trả một phần.</p>
        )}
      </KhoiForm>

      <KhoiForm tieu="Tiền thu">
        {sau.length > 0 && <SauPhieu o={sau} />}
        <PhanNhanBang form={form} set={set} loi={loi} onDoiCach={chonCach} taiKhoan={taiKhoan} dangTai={dangTaiTk}
          loiTai={loiTaiTk} tienTe="VND" onMoTaiKhoan={onMoTaiKhoan} nutThemTaiKhoan gon
          oNgay={
            <ONgayPhieu khoa="receipt_date" nhan="Ngày thu" min={ngayHdMuon ?? undefined} value={form.receipt_date}
              onChange={(v) => set("receipt_date", v)} loi={loi.receipt_date} />
          } />
      </KhoiForm>

      <KhoiForm tieu="Người nộp">
        <OF khoa="payer_name" nhan="Người nộp tiền" batBuoc rong loi={loi.payer_name}>
          <input id={idO("payer_name")} value={form.payer_name} aria-invalid={loi.payer_name ? true : undefined}
            onChange={(e) => set("payer_name", e.target.value)} />
        </OF>
        <GoiYTen goiY={goiY} dangChon={form.payer_name} onChon={(t) => set("payer_name", t)} nhan="Gợi ý người nộp tiền" />
        <OF khoa="content" nhan="Lý do nộp" rong>
          <input id={idO("content")} value={form.content} placeholder="Để trống thì máy ghi số hoá đơn và mã đơn"
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
          goi={'Ví dụ một sao kê khách chuyển cả lượt. Số ảnh in thành "Kèm theo" trên phiếu.'} />
        <OF khoa="note" nhan="Ghi chú nội bộ" rong goi="Không in lên phiếu">
          <textarea id={idO("note")} value={form.note ?? ""} onChange={(e) => set("note", e.target.value)} />
        </OF>
      </KhoiForm>
    </KhungFormPhieu>
  );
}
