/** Thân form phiếu chi RỜI (bố cục chia đôi, phương án B 06/10/2026) — CHUNG cho nút "Lập phiếu chi"
 *  trên đầu màn (khoản chi khác) và nút "Lập phiếu chi" ở hàng gia công chờ chi: hai nút mở cùng
 *  một giao diện, chỉ khác số điền sẵn và dải tóm tắt việc gia công.
 *
 *  - `ThanPhieuChiRoi`: các khối bên trái theo kiểu mới (như ngăn Thu tiền hoá đơn): "Tiền chi" (ô
 *    tiền lớn + bằng chữ, Ngày chi | Trả bằng, tài khoản trả) → "Người nhận" (+ Lý do chi) → "Chứng từ".
 *  - `BanXemPhieuChi`: tờ phiếu 02-TT xem trước bên phải (số phiếu tiền tố PC / UNC theo cách trả).
 *  Form cha giữ state, luật kiểm và payload — khối này chỉ hiển thị.
 */
import type { ReactNode } from "react";

import type { CompanyBankAccountRow, PaymentVoucherBaseInput, PaymentVoucherSource, PaymentVoucherType } from "../../../../api/client";
import { BanXemPhieu } from "../../shared/BanXemPhieu";
import { OChonMuc, type useMucThuChi } from "../../shared/OChonMuc";
import { KhoiForm, ONgayPhieu, OTienLon } from "../../shared/KhungFormPhieu";
import { dongPhuPhieuChi } from "../print";
import { optional } from "../shared/helpers";
import { HangTraBang, KhoiChungTuChi, KhoiNguoiNhan, type GoiYNguoi } from "./KhoiPhieuChi";
import { OF, idO, type DatO, type LoiForm } from "./KhungFormPhieu";

/** Tờ phiếu chi xem trước — cùng dòng với bản in (`dongPhuPhieuChi`). */
export function BanXemPhieuChi({
  form,
  taiKhoan,
  soChungTu,
  nguon,
  tenMuc,
  soDot,
}: {
  form: PaymentVoucherBaseInput;
  taiKhoan: CompanyBankAccountRow[];
  soChungTu: number;
  nguon: PaymentVoucherSource;
  /** Tên mục chi đang chọn — in dòng "Mục chi". */
  tenMuc?: string | null;
  /** Số thứ tự đợt giao đang trả — in "Đợt thanh toán: Đợt N". */
  soDot?: number | null;
}) {
  const ck = form.voucher_type === "bank_transfer";
  const tk = taiKhoan.find((t) => t.id === form.company_bank_account_id);
  return (
    <BanXemPhieu
      kind="chi"
      tienTo={ck ? "UNC" : "PC"}
      ngay={form.voucher_date}
      nguoi={ck ? optional(form.beneficiary_account_holder) ?? form.cash_recipient_name : form.cash_recipient_name}
      diaChi={ck ? null : optional(form.cash_recipient_address)}
      lyDo={form.content}
      dongPhu={dongPhuPhieuChi({
        voucher_type: form.voucher_type,
        source_type: nguon,
        muc_thu_chi_ten: tenMuc ?? null,
        delivery_seq_no: soDot ?? null,
        payment_stage: form.payment_stage,
        company_account_number: tk?.account_number ?? null,
        company_bank_name: tk?.bank_name ?? null,
        beneficiary_account_number: optional(form.beneficiary_account_number),
        beneficiary_bank_name: optional(form.beneficiary_bank_name),
        invoice_number: optional(form.invoice_number),
        bank_reference: null,
      }).map((l) =>
        // Chưa chọn tài khoản nào thì "Hình thức" chỉ ghi "Chuyển khoản", khỏi chuỗi "— tại —".
        l.label === "Hình thức" && !tk && !optional(form.beneficiary_account_number) ? { ...l, value: "Chuyển khoản" } : l,
      )}
      soTien={form.amount}
      soChungTu={soChungTu}
    />
  );
}

/** Ô Ngày chi của hàng "Ngày chi | Trả bằng". */
export function ONgayChiGon({ form, set, loi }: { form: PaymentVoucherBaseInput; set: DatO; loi: LoiForm }) {
  return (
    <ONgayPhieu khoa="voucher_date" nhan="Ngày chi" value={form.voucher_date}
      onChange={(v) => set("voucher_date", v)} loi={loi.voucher_date} />
  );
}

export function ThanPhieuChiRoi({
  form,
  set,
  loi,
  onDoiCach,
  taiKhoan,
  dangTai,
  loiTai,
  onMoTaiKhoan,
  files,
  setFiles,
  loiTep,
  setLoiTep,
  goiSoTien,
  goiY,
  muc,
  nutDu,
  vuot,
}: {
  form: PaymentVoucherBaseInput;
  set: DatO;
  loi: LoiForm;
  onDoiCach: (v: PaymentVoucherType) => void;
  taiKhoan: CompanyBankAccountRow[];
  dangTai: boolean;
  loiTai: string | null;
  onMoTaiKhoan?: () => void;
  files: File[];
  setFiles: (next: File[]) => void;
  loiTep: string | null;
  setLoiTep: (l: string | null) => void;
  /** Dòng nhắc dưới ô Số tiền (vd "Gõ theo hoá đơn của nhà gia công."). */
  goiSoTien?: ReactNode;
  /** Chip gợi ý người nhận tiền. */
  goiY?: GoiYNguoi[];
  /** Danh mục mục chi (form cha nạp bằng `useMucThuChi("chi")`). Vắng = phiếu sinh từ nghiệp vụ
   *  (gia công, trả lại tiền cho khách…): mục cố định của nguồn, không có ô Mục. */
  muc?: ReturnType<typeof useMucThuChi>;
  /** Nút "Trả đủ …" dưới ô số tiền. */
  nutDu?: { nhan: string; so: number };
  /** Số tiền vượt mức cho phép — viền đỏ + câu đỏ (form cha tự chặn nút lập). */
  vuot?: string | null;
}) {
  return (
    <>
      <KhoiForm tieu="Tiền chi">
        <OTienLon khoa="amount" nhan="Số tiền chi" value={form.amount} onChange={(v) => set("amount", v)} loi={loi.amount}
          nutDu={nutDu} vuot={vuot}
          goiTrong="Nhập số tiền chi ra" con={goiSoTien ? <p className="kt-khac">{goiSoTien}</p> : undefined} />
        <HangTraBang form={form} onDoiCach={onDoiCach} loi={loi} taiKhoan={taiKhoan} dangTai={dangTai} loiTai={loiTai}
          chonTaiKhoan={(v) => set("company_bank_account_id", v ? Number(v) : null)} onMoTaiKhoan={onMoTaiKhoan}
          oNgay={<ONgayChiGon form={form} set={set} loi={loi} />} />
      </KhoiForm>

      <KhoiNguoiNhan form={form} set={set} loi={loi} luonCoTen goiY={goiY}>
        {muc && (
          <OChonMuc loai="chi" ds={muc.ds} dangTai={muc.dangTai} loiTai={muc.loi}
            value={form.muc_thu_chi_id} loi={loi.muc_thu_chi_id}
            onChange={(id) => set("muc_thu_chi_id", id)} />
        )}
        <OF khoa="content" nhan="Lý do chi" batBuoc rong loi={loi.content}>
          <input id={idO("content")} value={form.content} placeholder="VD: Tiền điện tháng 9 xưởng in"
            aria-invalid={loi.content ? true : undefined}
            onChange={(e) => set("content", e.target.value)} />
        </OF>
      </KhoiNguoiNhan>

      <KhoiChungTuChi form={form} set={set} coHopDong={false} files={files} setFiles={setFiles}
        loiTep={loiTep} setLoiTep={setLoiTep} />
    </>
  );
}
