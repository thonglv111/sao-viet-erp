/** Các khối của form PHIẾU CHI kiểu mới (06/10/2026, docs/mockups/thu-tien-ngan-chong-phuong-an-3-ban-2.html
 *  — đối xứng với form phiếu thu): dùng chung cho Lập phiếu chi rời, phiếu chi gia công, phiếu chi
 *  theo đơn mua và ngăn chồng Trả nhiều đợt của Công nợ phải trả.
 *
 *  - `HangTraBang`: một hàng [Ngày chi | Trả bằng (hai nút trong một khung)] + "Trả từ tài khoản" khi
 *    chuyển khoản — nằm trong khối "Tiền chi".
 *  - `KhoiNguoiNhan`: Người nhận tiền + chip gợi ý; tiền mặt thêm Địa chỉ | Giấy tờ, chuyển khoản thêm
 *    tài khoản người nhận. `children` (Lý do chi) nằm cuối khối.
 *  - `KhoiChungTuChi`: Số chứng từ | Ngày chứng từ (| Số hợp đồng), ảnh chứng từ, ghi chú nội bộ.
 *  - `useGoiYNhaCungCap`: chip tên nhà cung cấp + người liên hệ (đọc hồ sơ NCC; thiếu quyền thì chỉ
 *    còn chip tên).
 *  Form cha giữ state, luật kiểm và payload — các khối chỉ hiển thị.
 */
import { ChonNgay } from "../../../../components/ChonNgay";
import { useEffect, useState, type ReactNode } from "react";

import { api, type CompanyBankAccountRow, type PaymentVoucherBaseInput, type PaymentVoucherType } from "../../../../api/client";
import { useAuth } from "../../../../auth/useAuth";
import { homNayVN } from "../../../../utils/ky";
import { GoiYTen, KhoiForm } from "../../shared/KhungFormPhieu";
import { vietSdt } from "../../shared/oCongNo";
import { OChungTu } from "../../shared/tepChungTu";
import { idO, OF, type DatO, type LoiForm } from "./KhungFormPhieu";
import { ChonCachTra } from "./VoucherSegments";

/** Thứ tự ô của form kiểu mới — con trỏ nhảy tới ô sai đầu tiên theo đúng thứ tự mắt đọc. */
export const THU_TU_O_MOI = [
  "delivery_id",
  "amount",
  "currency",
  "exchange_rate",
  "voucher_date",
  "voucher_type",
  "company_bank_account_id",
  "cash_recipient_name",
  "beneficiary_bank_name",
  "beneficiary_account_number",
  "beneficiary_account_holder",
  "muc_thu_chi_id",
  "customer_id",
  "content",
  "chung_tu",
];

export type GoiYNguoi = { ten: string; nhan?: string; phu?: string };

/** Chip người nhận từ hồ sơ nhà cung cấp: tên NCC + người liên hệ (kèm số điện thoại). */
export function useGoiYNhaCungCap(supplierId: number | null | undefined, supplierName: string | null | undefined): GoiYNguoi[] {
  const { token } = useAuth();
  const [lienHe, setLienHe] = useState<{ ten: string; sdt: string | null } | null>(null);
  useEffect(() => {
    if (!token || !supplierId) return;
    let song = true;
    // Đọc hồ sơ NCC là phụ: lỗi (kể cả lỗi đồng bộ) chỉ làm mất chip người liên hệ.
    Promise.resolve()
      .then(() => api.suppliers.get(token, supplierId))
      .then((s) => song && setLienHe(s.contact_name?.trim() ? { ten: s.contact_name.trim(), sdt: s.phone } : null))
      .catch(() => song && setLienHe(null));
    return () => {
      song = false;
    };
  }, [token, supplierId]);
  const ten = (supplierName ?? "").trim();
  return [
    ...(ten ? [{ ten, phu: "nhà cung cấp" }] : []),
    ...(lienHe && lienHe.ten !== ten
      ? [{ ten: lienHe.ten, phu: `người liên hệ${lienHe.sdt ? ` ${vietSdt(lienHe.sdt)}` : ""}` }]
      : []),
  ];
}

export function HangTraBang({
  form,
  onDoiCach,
  oNgay,
  loi,
  taiKhoan,
  dangTai,
  loiTai,
  chonTaiKhoan,
  onMoTaiKhoan,
  khoaCach = "voucher_type",
}: {
  form: PaymentVoucherBaseInput;
  onDoiCach: (v: PaymentVoucherType) => void;
  oNgay: ReactNode;
  loi: LoiForm;
  taiKhoan: CompanyBankAccountRow[];
  dangTai: boolean;
  loiTai?: string | null;
  chonTaiKhoan: (value: string) => void;
  onMoTaiKhoan?: () => void;
  khoaCach?: string;
}) {
  const ck = form.voucher_type === "bank_transfer";
  const khongCo = !dangTai && !loiTai && taiKhoan.length === 0;
  const tk = taiKhoan.find((t) => t.id === form.company_bank_account_id);
  return (
    <>
      <div className="kt-f__hang">
        {oNgay}
        <div className="kt-o">
          <span className="kt-o__nhan">Trả bằng</span>
          <ChonCachTra giaTri={form.voucher_type} onDoi={onDoiCach} khoa={khoaCach} gon />
        </div>
      </div>
      {ck && (
        <>
          <div className="kt-f__hang">
            <OF khoa="company_bank_account_id" nhan="Trả từ tài khoản" batBuoc rong loi={loi.company_bank_account_id}
              goi={loiTai ?? (dangTai ? "Đang tải tài khoản công ty…" : tk ? `Chủ tài khoản ${tk.account_holder}` : undefined)}>
              <select id={idO("company_bank_account_id")} value={form.company_bank_account_id ?? ""}
                disabled={dangTai || taiKhoan.length === 0}
                aria-invalid={loi.company_bank_account_id ? true : undefined}
                onChange={(e) => chonTaiKhoan(e.target.value)}>
                <option value="">Chọn tài khoản công ty</option>
                {taiKhoan.map((t) => (
                  <option key={t.id} value={t.id}>
                    {`${t.account_number} tại ${t.bank_name}${t.bank_branch ? ` ${t.bank_branch}` : ""}${t.currency !== "VND" ? ` (${t.currency})` : ""}`}
                  </option>
                ))}
              </select>
            </OF>
          </div>
          {khongCo && (
            <p className="kt-canh" role="status">
              Chưa có tài khoản công ty dùng để chi — thêm ở{" "}
              {onMoTaiKhoan ? (
                <button type="button" className="kt-lk" onClick={onMoTaiKhoan}>Tài khoản ngân hàng</button>
              ) : (
                "Tài khoản ngân hàng"
              )}
            </p>
          )}
        </>
      )}
    </>
  );
}

export function KhoiNguoiNhan({
  form,
  set,
  loi,
  luonCoTen,
  goiY = [],
  khoaTen,
  children,
}: {
  form: PaymentVoucherBaseInput;
  set: DatO;
  loi: LoiForm;
  /** Có = tên người nhận do máy khoá (vd. chi chiết khấu trả đúng khách) — câu này hiện dưới ô. */
  khoaTen?: string;
  /** Có ô Người nhận tiền cả khi chuyển khoản (phiếu chi rời / gia công). Không có thì ô tên chỉ ở tiền mặt. */
  luonCoTen: boolean;
  goiY?: GoiYNguoi[];
  /** Ô Lý do chi — cuối khối. */
  children?: ReactNode;
}) {
  const ck = form.voucher_type === "bank_transfer";
  const coTen = luonCoTen || !ck;
  return (
    <KhoiForm tieu="Người nhận">
      {coTen && (
        <>
          <OF khoa="cash_recipient_name" nhan="Người nhận tiền" batBuoc rong loi={loi.cash_recipient_name}
            goi={khoaTen ?? (ck ? undefined : "Người ký nhận trên phiếu chi")}>
            <input id={idO("cash_recipient_name")} value={form.cash_recipient_name ?? ""}
              placeholder="Người hoặc đơn vị nhận tiền" readOnly={!!khoaTen}
              aria-invalid={loi.cash_recipient_name ? true : undefined}
              onChange={(e) => set("cash_recipient_name", e.target.value)} />
          </OF>
          {!khoaTen && (
            <GoiYTen goiY={goiY} dangChon={form.cash_recipient_name ?? ""} onChon={(t) => set("cash_recipient_name", t)}
              nhan="Gợi ý người nhận tiền" />
          )}
        </>
      )}
      {ck ? (
        <>
          <div className="kt-f__tieu kt-f__tieu--con">Tài khoản người nhận</div>
          <div className="kt-f__hang">
            <OF khoa="beneficiary_bank_name" nhan="Ngân hàng" batBuoc loi={loi.beneficiary_bank_name}>
              <input id={idO("beneficiary_bank_name")} value={form.beneficiary_bank_name ?? ""}
                aria-invalid={loi.beneficiary_bank_name ? true : undefined}
                onChange={(e) => set("beneficiary_bank_name", e.target.value)} />
            </OF>
            <OF khoa="beneficiary_account_number" nhan="Số tài khoản" batBuoc loi={loi.beneficiary_account_number}>
              <input id={idO("beneficiary_account_number")} inputMode="numeric" value={form.beneficiary_account_number ?? ""}
                aria-invalid={loi.beneficiary_account_number ? true : undefined}
                onChange={(e) => set("beneficiary_account_number", e.target.value)} />
            </OF>
          </div>
          <div className="kt-f__hang">
            <OF khoa="beneficiary_account_holder" nhan="Chủ tài khoản" batBuoc loi={loi.beneficiary_account_holder}>
              <input id={idO("beneficiary_account_holder")} value={form.beneficiary_account_holder ?? ""}
                aria-invalid={loi.beneficiary_account_holder ? true : undefined}
                onChange={(e) => set("beneficiary_account_holder", e.target.value)} />
            </OF>
            <OF khoa="beneficiary_bank_branch" nhan="Chi nhánh">
              <input id={idO("beneficiary_bank_branch")} value={form.beneficiary_bank_branch ?? ""} placeholder="Không bắt buộc"
                onChange={(e) => set("beneficiary_bank_branch", e.target.value)} />
            </OF>
          </div>
        </>
      ) : (
        <div className="kt-f__hang">
          <OF khoa="cash_recipient_address" nhan="Địa chỉ người nhận">
            <input id={idO("cash_recipient_address")} value={form.cash_recipient_address ?? ""}
              placeholder="Không bắt buộc. Có thì in lên phiếu"
              onChange={(e) => set("cash_recipient_address", e.target.value)} />
          </OF>
          <OF khoa="cash_recipient_identity" nhan="Giấy tờ (CCCD)">
            <input id={idO("cash_recipient_identity")} value={form.cash_recipient_identity ?? ""} placeholder="Không bắt buộc"
              onChange={(e) => set("cash_recipient_identity", e.target.value)} />
          </OF>
        </div>
      )}
      {children}
    </KhoiForm>
  );
}

export function KhoiChungTuChi({
  form,
  set,
  coHopDong,
  files,
  setFiles,
  loiTep,
  setLoiTep,
  nhanTep,
  goiTep = 'Hoá đơn, biên nhận, UNC. Số ảnh in thành "Kèm theo" trên phiếu.',
  coSoChungTu = true,
}: {
  form: PaymentVoucherBaseInput;
  set: DatO;
  coHopDong: boolean;
  files: File[];
  setFiles: (next: File[]) => void;
  loiTep: string | null | undefined;
  setLoiTep: (l: string | null) => void;
  nhanTep?: string;
  goiTep?: string;
  /** Trả nhiều đợt: mỗi phiếu tự ghi số hoá đơn của đợt nên không có ô số chứng từ chung. */
  coSoChungTu?: boolean;
}) {
  return (
    <KhoiForm tieu="Chứng từ">
      {coSoChungTu && (
        <div className="kt-f__hang">
          <OF khoa="invoice_number" nhan="Số chứng từ">
            <input id={idO("invoice_number")} value={form.invoice_number ?? ""} placeholder="Số hoá đơn, biên nhận…"
              onChange={(e) => set("invoice_number", e.target.value)} />
          </OF>
          <OF khoa="invoice_date" nhan="Ngày chứng từ" ngay>
            <ChonNgay id={idO("invoice_date")} aria-label="Ngày chứng từ" max={homNayVN()} value={form.invoice_date ?? ""}
              onChange={(v) => set("invoice_date", v || null)} />
          </OF>
          {coHopDong && (
            <OF khoa="contract_number" nhan="Số hợp đồng">
              <input id={idO("contract_number")} value={form.contract_number ?? ""}
                onChange={(e) => set("contract_number", e.target.value)} />
            </OF>
          )}
        </div>
      )}
      <OChungTu files={files} setFiles={setFiles} loi={loiTep ?? undefined} onLoi={setLoiTep} nhan={nhanTep} goi={goiTep} />
      {coSoChungTu && (
        <OF khoa="note" nhan="Ghi chú nội bộ" rong goi="Không in lên phiếu">
          <textarea id={idO("note")} value={form.note ?? ""} onChange={(e) => set("note", e.target.value)} />
        </OF>
      )}
    </KhoiForm>
  );
}
