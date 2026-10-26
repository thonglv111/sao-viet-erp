// Lập PHIẾU CHI CHIẾT KHẤU / KÊ (20/10/2026) từ hàng "Chờ chi CK / kê" của màn Phiếu chi. Một phiếu cho
// một hay nhiều hóa đơn CÙNG khách, CÙNG loại. Mỗi hóa đơn một ô "Chi lần này" điền sẵn phần còn phải
// chi, sửa nhỏ hơn được (chi một phần). Chiết khấu trả đúng khách ⇒ tên người nhận khoá theo khách; kê
// thì người dùng gõ người nhận. Phiếu thuộc mục cố định "Chi chiết khấu trả khách" / "Chi kê trả khách".
// Cùng khuôn với `LapPhieuChiGop` (phiếu chi gộp của nhà cung cấp).
import { ChevronRight, CircleAlert } from "lucide-react";
import { useEffect, useState } from "react";

import {
  ApiError,
  api,
  type CkKeChoChi,
  type CompanyBankAccountRow,
  type PaymentVoucherBaseInput,
  type PaymentVoucherRow,
  type PhieuChiCkKeInput,
} from "../../../../api/client";
import { useAuth } from "../../../../auth/useAuth";
import { OGoDinhDang } from "../../../../components/OGoDinhDang";
import { ngay, tien, vietSo } from "../../shared/dinhDang";
import { HangDoiChieu, KhoiForm, ONgayPhieu } from "../../shared/KhungFormPhieu";
import { TEN_LOAI_CK_KE } from "../components/HangChoCkKe";
import { HangTraBang, KhoiChungTuChi, KhoiNguoiNhan } from "../components/KhoiPhieuChi";
import { KhungFormPhieu, OF, idO, loiNgayChi, nhayToiLoi, type DatO, type LoiForm } from "../components/KhungFormPhieu";
import { loiChuyenKhoan } from "../components/VoucherRecipientSection";
import { isoToday, optional } from "../shared/helpers";
import "../../ke-toan.css";

const THU_TU = [
  "khoan",
  "voucher_date",
  "voucher_type",
  "company_bank_account_id",
  "cash_recipient_name",
  "beneficiary_bank_name",
  "beneficiary_account_number",
  "beneficiary_account_holder",
  "chung_tu",
];

export function LapPhieuChiCkKeModal({
  dong,
  onClose,
  onSaved,
  onMoTaiKhoan,
}: {
  /** ẢNH CHỤP các khoản lúc mở — cùng khách, cùng loại. */
  dong: CkKeChoChi[];
  onClose: () => void;
  /** Đã lập xong (kể cả khi chứng từ tải hỏng — phiếu VẪN đã lập). */
  onSaved: (voucher: PaymentVoucherRow) => void;
  onMoTaiKhoan?: () => void;
}) {
  const { token } = useAuth();
  const loai = dong[0].loai;
  const laCk = loai === "chiet_khau";
  const khach = dong[0].customer_name;
  const tenLoai = TEN_LOAI_CK_KE[loai];
  const [form, setForm] = useState<PaymentVoucherBaseInput>(() => ({
    voucher_type: "cash",
    payment_stage: "other",
    voucher_date: isoToday(),
    amount: 0,
    currency: "VND",
    exchange_rate: 1,
    content: "",
    company_bank_account_id: null,
    cash_recipient_name: laCk ? khach : "",
    cash_recipient_address: "",
    cash_recipient_identity: "",
    beneficiary_account_holder: laCk ? khach : "",
    beneficiary_account_number: "",
    beneficiary_bank_name: "",
    beneficiary_bank_branch: "",
  }));
  const [dau] = useState(form);
  const [soChi, setSoChi] = useState<Record<number, number>>(() =>
    Object.fromEntries(dong.map((r) => [r.sales_invoice_id, r.con])),
  );
  const [taiKhoan, setTaiKhoan] = useState<CompanyBankAccountRow[]>([]);
  const [dangTaiTk, setDangTaiTk] = useState(true);
  const [loiTk, setLoiTk] = useState<string | null>(null);
  const [loi, setLoi] = useState<LoiForm>({});
  const [loiChung, setLoiChung] = useState<string | null>(null);
  const [dangLuu, setDangLuu] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [daLap, setDaLap] = useState<PaymentVoucherRow | null>(null);

  useEffect(() => {
    if (!token) return;
    setDangTaiTk(true);
    api.accounting
      .companyAccounts(token, true, "pay")
      .then((r) => {
        setTaiKhoan(r);
        setLoiTk(null);
      })
      .catch(() => setLoiTk("Không tải được danh sách tài khoản ngân hàng."))
      .finally(() => setDangTaiTk(false));
  }, [token]);

  const set: DatO = (khoa, giaTri) => {
    setForm((f) => ({ ...f, [khoa]: giaTri }));
    setLoi((l) => (l[khoa] ? { ...l, [khoa]: undefined } : l));
  };

  const n = dong.length;
  const tong = dong.reduce((s, r) => s + (soChi[r.sales_invoice_id] ?? 0), 0);
  const isBank = form.voucher_type === "bank_transfer";
  const sai = (r: CkKeChoChi) => {
    const v = soChi[r.sales_invoice_id] ?? 0;
    return v <= 0 || v > r.con;
  };

  async function submit() {
    if (daLap) {
      onSaved(daLap);
      return;
    }
    if (!token || dangLuu || n === 0) return;
    const khoanSai = dong.find(sai);
    const moi: LoiForm = {
      khoan: khoanSai
        ? (soChi[khoanSai.sales_invoice_id] ?? 0) <= 0
          ? `Hóa đơn ${khoanSai.invoice_number} chưa có số tiền chi.`
          : `Hóa đơn ${khoanSai.invoice_number} chi quá phần còn phải chi (${tien(khoanSai.con)}).`
        : undefined,
      voucher_date: loiNgayChi(form.voucher_date),
      cash_recipient_name: !(form.cash_recipient_name ?? "").trim() ? "Ghi người nhận tiền." : undefined,
      ...loiChuyenKhoan(form),
    };
    if (Object.values(moi).some(Boolean)) {
      setLoi(moi);
      if (moi.khoan && khoanSai) document.getElementById(idO(`khoan-${khoanSai.sales_invoice_id}`))?.focus();
      else nhayToiLoi(moi, THU_TU);
      return;
    }
    const payload: PhieuChiCkKeInput = {
      loai,
      dong: dong.map((r) => ({ sales_invoice_id: r.sales_invoice_id, amount: soChi[r.sales_invoice_id] ?? 0 })),
      voucher_type: form.voucher_type,
      voucher_date: form.voucher_date,
      content: optional(form.content),
      company_bank_account_id: isBank ? (form.company_bank_account_id ?? null) : null,
      cash_recipient_name: optional(form.cash_recipient_name),
      cash_recipient_address: isBank ? null : optional(form.cash_recipient_address),
      cash_recipient_identity: isBank ? null : optional(form.cash_recipient_identity),
      beneficiary_account_holder: isBank ? optional(form.beneficiary_account_holder) : null,
      beneficiary_account_number: isBank ? optional(form.beneficiary_account_number) : null,
      beneficiary_bank_name: isBank ? optional(form.beneficiary_bank_name) : null,
      beneficiary_bank_branch: isBank ? optional(form.beneficiary_bank_branch) : null,
      bank_fee_bearer: "payer",
    };
    setDangLuu(true);
    setLoiChung(null);
    try {
      const voucher = await api.accounting.createVoucherCkKe(token, payload);
      if (files.length) {
        let hong = false;
        for (const file of files) {
          try {
            await api.accounting.uploadVoucherAttachment(token, voucher.id, file);
          } catch {
            hong = true;
          }
        }
        if (hong) {
          setDaLap(voucher);
          setLoiChung(
            `Đã lập phiếu chi ${voucher.code} nhưng chứng từ tải lên thất bại. Mở phiếu đó ở màn Phiếu chi để đính kèm lại.`,
          );
          return;
        }
      }
      onSaved(voucher);
    } catch (err) {
      setLoiChung(err instanceof ApiError ? err.message : "Không lập được phiếu chi.");
    } finally {
      setDangLuu(false);
    }
  }

  const goDo = () =>
    files.length > 0 ||
    dong.some((r) => soChi[r.sales_invoice_id] !== r.con) ||
    (Object.keys(dau) as (keyof PaymentVoucherBaseInput)[]).some((k) => form[k] !== dau[k]);

  return (
    <KhungFormPhieu
      duongDan={
        <>
          Phiếu chi
          <ChevronRight size={14} aria-hidden="true" />
          Chờ chi CK / kê
          <ChevronRight size={14} aria-hidden="true" />
          {khach}
        </>
      }
      tieuDe={`Chi ${tenLoai.toLowerCase()} trả khách`}
      phuDe={<span className="kt-tag">{`Khách hàng ${khach}`}</span>}
      xemTruoc={
        daLap ? <>Phiếu <b>{daLap.code}</b> đã lập.</> : (
          <>
            {"Một phiếu chi tổng "}
            <b>{tien(tong)}</b>
          </>
        )
      }
      dangLuu={dangLuu}
      loiChung={loiChung}
      onDong={() => (daLap ? onSaved(daLap) : onClose())}
      chanDong={() => !daLap && goDo()}
      onSubmit={() => void submit()}
      nhanNut={daLap ? "Xong" : "Lập phiếu chi"}
      khoaNut={!daLap && n === 0}
      kieuMoi
    >
      <KhoiForm tieu="Các hóa đơn trong phiếu">
        <HangDoiChieu
          o={[
            { nhan: "Khoản chi", giaTri: tenLoai },
            { nhan: "Số hóa đơn", giaTri: vietSo(n) },
            { nhan: "Tổng phiếu", giaTri: tien(tong), chot: true },
          ]}
        />
        <div className="lds-bang kt-gop-bang">
          <table className="lds-g" style={{ minWidth: laCk ? 560 : 680 }} aria-label="Các hóa đơn trong phiếu">
            <thead>
              <tr>
                <th>Hóa đơn</th>
                <th>Ngày</th>
                <th>Đơn hàng</th>
                <th className="n">{tenLoai}</th>
                {!laCk && <th className="n">Thuế TNDN</th>}
                <th className="n">Còn phải chi</th>
                <th className="n">Chi lần này</th>
              </tr>
            </thead>
            <tbody>
              {dong.map((r) => {
                const v = soChi[r.sales_invoice_id] ?? 0;
                return (
                  <tr key={r.sales_invoice_id}>
                    <td>{r.invoice_number}</td>
                    <td>{ngay(r.invoice_date)}</td>
                    <td>{r.order_code}</td>
                    <td className="n">{vietSo(r.tien)}</td>
                    {!laCk && <td className="n">{vietSo(r.thue_tndn)}</td>}
                    <td className="n">{vietSo(r.con)}</td>
                    <td className="n">
                      <div className="kt-o-tien kt-o-tien--nho kt-gop-o">
                        <OGoDinhDang id={idO(`khoan-${r.sales_invoice_id}`)} type="text" inputMode="numeric" placeholder="0"
                          aria-label={`Chi lần này hóa đơn ${r.invoice_number}`} aria-invalid={sai(r) || undefined}
                          value={v ? v.toLocaleString("vi-VN") : ""}
                          onChange={(e) => {
                            const so = e.target.value.replace(/\D/g, "");
                            setSoChi((cu) => ({ ...cu, [r.sales_invoice_id]: so ? Number(so) : 0 }));
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
          <p className="kt-khac">
            {laCk
              ? "Mỗi hóa đơn điền sẵn phần còn phải chi. Sửa số để chi một phần."
              : "Kê chi lại đã trừ thuế TNDN trên kê. Mỗi hóa đơn điền sẵn phần còn phải chi, sửa số để chi một phần."}
          </p>
        )}
      </KhoiForm>

      <KhoiForm tieu="Tiền chi">
        <HangTraBang form={form} onDoiCach={(v) => set("voucher_type", v)} loi={loi} taiKhoan={taiKhoan}
          dangTai={dangTaiTk} loiTai={loiTk} chonTaiKhoan={(v) => set("company_bank_account_id", v ? Number(v) : null)}
          onMoTaiKhoan={onMoTaiKhoan}
          oNgay={
            <ONgayPhieu khoa="voucher_date" nhan="Ngày chi" value={form.voucher_date}
              onChange={(v) => set("voucher_date", v)} loi={loi.voucher_date} />
          } />
      </KhoiForm>

      <KhoiNguoiNhan form={form} set={set} loi={loi} luonCoTen
        khoaTen={laCk ? "Chiết khấu trả đúng khách của hóa đơn" : undefined}>
        <OF khoa="content" nhan="Lý do chi" rong>
          <input id={idO("content")} value={form.content}
            placeholder={`Để trống thì máy ghi "Chi ${tenLoai.toLowerCase()} hóa đơn ${dong.map((r) => r.invoice_number).join(", ")}"`}
            onChange={(e) => set("content", e.target.value)} />
        </OF>
      </KhoiNguoiNhan>

      <KhoiChungTuChi form={form} set={set} coHopDong={false} coSoChungTu={false} files={files} setFiles={setFiles}
        loiTep={loi.chung_tu} setLoiTep={(l) => setLoi((cu) => ({ ...cu, chung_tu: l ?? undefined }))}
        nhanTep="Ảnh chứng từ của phiếu"
        goiTep="Ví dụ UNC hoặc giấy ký nhận. Số ảnh in thành Kèm theo trên phiếu." />
    </KhungFormPhieu>
  );
}
