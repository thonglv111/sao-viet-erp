// Ngăn chồng LẬP MỘT PHIẾU CHI cho NHIỀU khoản của CÙNG một nhà cung cấp (chủ chốt 17/10/2026: "một
// phiếu cho cả lượt") — cọc, đợt giao, của một hay nhiều đơn mua. Thay "Trả nhiều đợt" cũ (mỗi đợt ra
// một phiếu riêng).
//
// Một số phiếu chi, bên trong là bảng "Các khoản trong phiếu": mỗi khoản một ô "Chi lần này" điền sẵn
// bằng phần còn phải chi, sửa được (trả một phần). Máy chủ kiểm lại trần từng khoản như phiếu lẻ và chỉ
// ghi khi MỌI khoản hợp lệ. Chứng từ (UNC, biên nhận) đính MỘT lần vào chính phiếu đó.
//
// Mở từ hai chỗ: hàng "Mua hàng chờ chi" của màn Phiếu chi và ngăn nhà cung cấp ở Công nợ phải trả.
import { ChevronRight, CircleAlert } from "lucide-react";
import { useEffect, useState } from "react";

import {
  ApiError,
  api,
  type CompanyBankAccountRow,
  type PaymentVoucherBaseInput,
  type PaymentVoucherRow,
  type PhieuChiGopInput,
} from "../../../../api/client";
import { useAuth } from "../../../../auth/useAuth";
import { OGoDinhDang } from "../../../../components/OGoDinhDang";
import { ngay, tien, vietSo } from "../../shared/dinhDang";
import { HangDoiChieu, KhoiForm, ONgayPhieu, SauPhieu } from "../../shared/KhungFormPhieu";
import { HangTraBang, KhoiChungTuChi, KhoiNguoiNhan, useGoiYNhaCungCap } from "./KhoiPhieuChi";
import { KhungFormPhieu, OF, idO, loiNgayChi, nhayToiLoi, type DatO, type LoiForm } from "./KhungFormPhieu";
import { loiChuyenKhoan } from "./VoucherRecipientSection";
import { isoToday, optional } from "../shared/helpers";

/** Một khoản đưa vào phiếu: CỌC của đơn (`delivery_id` trống) hoặc một đợt giao. `con` = trần. */
export type KhoanGop = {
  purchase_request_id: number;
  ma_don: string;
  delivery_id: number | null;
  /** "Cọc" / "Đợt 2" — chữ của cột Khoản. */
  nhan: string;
  han: string | null;
  con: number;
};

const khoaKhoan = (k: KhoanGop) => `${k.purchase_request_id}:${k.delivery_id ?? "coc"}`;

/** Thứ tự ô trên form — con trỏ nhảy tới ô sai đầu tiên. */
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

export function LapPhieuChiGop({
  supplierId,
  supplierName,
  khoan,
  conNoNcc,
  hanMuc = 0,
  onClose,
  onSaved,
  onMoTaiKhoan,
}: {
  supplierId?: number | null;
  supplierName: string;
  /** ẢNH CHỤP các khoản lúc mở — ngăn dưới nạp lại cũng không đổi form đang gõ. */
  khoan: KhoanGop[];
  /** Tổng còn nợ của nhà cung cấp — cho dải "sau phiếu này". */
  conNoNcc?: number | null;
  /** Hạn mức công nợ của nhà cung cấp; 0 = không đặt. */
  hanMuc?: number;
  onClose: () => void;
  /** Đã lập xong (kể cả khi chứng từ tải hỏng — phiếu VẪN đã lập). */
  onSaved: (voucher: PaymentVoucherRow) => void;
  onMoTaiKhoan?: () => void;
}) {
  const { token } = useAuth();
  // Cùng hình dạng dữ liệu với form phiếu chi để dùng lại khối "Trả bằng" / "Người nhận" / "Chứng từ".
  // `payment_stage`/`amount` chỉ để đủ kiểu — payload phiếu gộp dựng riêng bên dưới.
  const [form, setForm] = useState<PaymentVoucherBaseInput>(() => ({
    voucher_type: "cash",
    payment_stage: "final",
    voucher_date: isoToday(),
    amount: 0,
    currency: "VND",
    exchange_rate: 1,
    content: "",
    company_bank_account_id: null,
    cash_recipient_name: supplierName,
    cash_recipient_address: "",
    cash_recipient_identity: "",
    beneficiary_account_holder: supplierName,
    beneficiary_account_number: "",
    beneficiary_bank_name: "",
    beneficiary_bank_branch: "",
  }));
  const [dau] = useState(form);
  const [soChi, setSoChi] = useState<Record<string, number>>(() =>
    Object.fromEntries(khoan.map((k) => [khoaKhoan(k), k.con])),
  );
  const [taiKhoan, setTaiKhoan] = useState<CompanyBankAccountRow[]>([]);
  const [dangTaiTk, setDangTaiTk] = useState(true);
  const [loiTk, setLoiTk] = useState<string | null>(null);
  const [loi, setLoi] = useState<LoiForm>({});
  const [loiChung, setLoiChung] = useState<string | null>(null);
  const [dangLuu, setDangLuu] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  // Đã lập mà chứng từ tải hỏng: ở lại để người dùng đọc mã phiếu, nút chính thành "Xong".
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

  const n = khoan.length;
  const tong = khoan.reduce((s, k) => s + (soChi[khoaKhoan(k)] ?? 0), 0);
  const isBank = form.voucher_type === "bank_transfer";
  const sai = (k: KhoanGop) => {
    const v = soChi[khoaKhoan(k)] ?? 0;
    return v <= 0 || v > k.con;
  };

  async function submit() {
    if (daLap) {
      onSaved(daLap);
      return;
    }
    if (!token || dangLuu || n === 0) return;
    const khoanSai = khoan.find(sai);
    const moi: LoiForm = {
      khoan: khoanSai
        ? (soChi[khoaKhoan(khoanSai)] ?? 0) <= 0
          ? `${khoanSai.ma_don} ${khoanSai.nhan} chưa có số tiền chi.`
          : `${khoanSai.ma_don} ${khoanSai.nhan} chi quá phần còn phải chi (${tien(khoanSai.con)}).`
        : undefined,
      voucher_date: loiNgayChi(form.voucher_date),
      cash_recipient_name: !isBank && !(form.cash_recipient_name ?? "").trim() ? "Ghi người nhận tiền." : undefined,
      ...loiChuyenKhoan(form),
    };
    if (Object.values(moi).some(Boolean)) {
      setLoi(moi);
      if (moi.khoan && khoanSai) document.getElementById(idO(`khoan-${khoaKhoan(khoanSai)}`))?.focus();
      else nhayToiLoi(moi, THU_TU);
      return;
    }

    const payload: PhieuChiGopInput = {
      lines: khoan.map((k) => ({
        purchase_request_id: k.purchase_request_id,
        delivery_id: k.delivery_id,
        amount: soChi[khoaKhoan(k)] ?? 0,
      })),
      voucher_type: form.voucher_type,
      voucher_date: form.voucher_date,
      content: optional(form.content),
      company_bank_account_id: isBank ? (form.company_bank_account_id ?? null) : null,
      cash_recipient_name: isBank ? null : optional(form.cash_recipient_name),
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
      const voucher = await api.accounting.createVoucherGop(token, payload);
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
    khoan.some((k) => soChi[khoaKhoan(k)] !== k.con) ||
    (Object.keys(dau) as (keyof PaymentVoucherBaseInput)[]).some((k) => form[k] !== dau[k]);

  const goiY = useGoiYNhaCungCap(supplierId, supplierName);
  const sau = [
    ...(conNoNcc != null ? [{ nhan: "Nhà cung cấp còn nợ", tu: conNoNcc, den: conNoNcc - tong }] : []),
    ...(conNoNcc != null && hanMuc > 0 ? [{ nhan: "Hạn mức còn được nợ", den: hanMuc - (conNoNcc - tong) }] : []),
  ];
  const soDon = new Set(khoan.map((k) => k.purchase_request_id)).size;

  return (
    <KhungFormPhieu
      tang={1}
      duongDan={
        <>
          {supplierName}
          <ChevronRight size={14} aria-hidden="true" />
          {`Chi ${n} khoản`}
        </>
      }
      tieuDe={`Lập phiếu chi ${n} khoản`}
      phuDe={<span className="kt-tag">{`Nhà cung cấp ${supplierName}`}</span>}
      xemTruoc={
        <>
          {"Một phiếu chi tổng "}
          <b>{tien(tong)}</b>
        </>
      }
      dangLuu={dangLuu}
      loiChung={loiChung}
      // Phiếu đã lập (chứng từ hỏng) thì đóng cũng là "xong" — ngăn dưới phải nạp lại.
      onDong={() => (daLap ? onSaved(daLap) : onClose())}
      chanDong={() => !daLap && goDo()}
      onSubmit={() => void submit()}
      nhanNut={daLap ? "Xong" : "Lập phiếu chi"}
      khoaNut={!daLap && n === 0}
      kieuMoi
    >
      <KhoiForm tieu="Các khoản trong phiếu">
        <HangDoiChieu
          o={[
            { nhan: "Số khoản", giaTri: vietSo(n) },
            { nhan: "Số đơn mua", giaTri: vietSo(soDon) },
            { nhan: "Tổng phiếu", giaTri: tien(tong), chot: true },
          ]}
        />
        <div className="lds-bang kt-gop-bang">
          <table className="lds-g" style={{ minWidth: 560 }} aria-label="Các khoản trong phiếu">
            <colgroup>
              <col style={{ width: 120 }} />
              <col style={{ width: 80 }} />
              <col style={{ width: 100 }} />
              <col style={{ width: 120 }} />
              <col />
            </colgroup>
            <thead>
              <tr>
                <th>Đơn mua</th>
                <th>Khoản</th>
                <th>Hạn</th>
                <th className="n">Còn</th>
                <th className="n">Chi lần này</th>
              </tr>
            </thead>
            <tbody>
              {khoan.map((k) => {
                const khoa = khoaKhoan(k);
                const v = soChi[khoa] ?? 0;
                return (
                  <tr key={khoa}>
                    <td>{k.ma_don}</td>
                    <td>{k.nhan}</td>
                    <td>{k.han ? ngay(k.han) : ""}</td>
                    <td className="n">{vietSo(k.con)}</td>
                    <td className="n">
                      <div className="kt-o-tien kt-o-tien--nho kt-gop-o">
                        <OGoDinhDang id={idO(`khoan-${khoa}`)} type="text" inputMode="numeric" placeholder="0"
                          aria-label={`Chi lần này ${k.ma_don} ${k.nhan}`} aria-invalid={sai(k) || undefined}
                          value={v ? v.toLocaleString("vi-VN") : ""}
                          onChange={(e) => {
                            const so = e.target.value.replace(/\D/g, "");
                            setSoChi((cu) => ({ ...cu, [khoa]: so ? Number(so) : 0 }));
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
          <p className="kt-khac">Mỗi khoản điền sẵn phần còn phải chi. Sửa số để trả một phần.</p>
        )}
      </KhoiForm>

      <KhoiForm tieu="Tiền chi">
        {sau.length > 0 && <SauPhieu o={sau} />}
        <HangTraBang form={form} onDoiCach={(v) => set("voucher_type", v)} loi={loi} taiKhoan={taiKhoan}
          dangTai={dangTaiTk} loiTai={loiTk} chonTaiKhoan={(v) => set("company_bank_account_id", v ? Number(v) : null)}
          onMoTaiKhoan={onMoTaiKhoan}
          oNgay={
            <ONgayPhieu khoa="voucher_date" nhan="Ngày chi" value={form.voucher_date}
              onChange={(v) => set("voucher_date", v)} loi={loi.voucher_date} />
          } />
      </KhoiForm>

      <KhoiNguoiNhan form={form} set={set} loi={loi} luonCoTen={false} goiY={goiY}>
        <OF khoa="content" nhan="Lý do chi" rong>
          <input id={idO("content")} value={form.content} placeholder="Để trống thì máy ghi mã đơn và khoản"
            onChange={(e) => set("content", e.target.value)} />
        </OF>
      </KhoiNguoiNhan>

      <KhoiChungTuChi form={form} set={set} coHopDong={false} coSoChungTu={false} files={files} setFiles={setFiles}
        loiTep={loi.chung_tu} setLoiTep={(l) => setLoi((cu) => ({ ...cu, chung_tu: l ?? undefined }))}
        nhanTep="Ảnh chứng từ của phiếu"
        goiTep="Ví dụ một UNC trả cả lượt. Số ảnh in thành Kèm theo trên phiếu." />
    </KhungFormPhieu>
  );
}
