// Form LẬP PHIẾU CHI theo đơn mua hàng (đặc tả PC-4) — mở từ màn Đơn mua hàng của Kế toán.
// ⚠️ TIỀN THẬT. Giữ nguyên văn: `maxAmountVnd` (trần đặt cọc vs công nợ theo đợt), `amountVnd`,
// `chonLoai`, `selectType`, `selectCompanyAccount` và mọi luật chặn trong `kiemTra()` (trần, tỷ giá,
// đợt giao) cùng câu chữ của chúng. Các khối con chỉ HIỂN THỊ, nhận state qua props.
//
// Vỏ 06/10/2026: `NganPhai` (cùng độ rộng mọi ngăn, kéo rộng được), lỗi nằm TẠI Ô thay băng đỏ
// chung, con trỏ nhảy tới ô sai đầu tiên; form gõ dở thì Esc / Đóng hỏi trước.
//
// Kiểu khối mới (06/10/2026, đối xứng ngăn Thu tiền hoá đơn): "Đơn mua" (Giá trị đơn | Hàng đã giao |
// Đã chi | Còn được chi, Chi để, Đợt giao) → "Tiền chi" (ô tiền lớn + "Trả đủ" + dải sau phiếu, Ngày chi
// | Trả bằng, tài khoản trả) → "Người nhận" (chip NCC + người liên hệ; Lý do chi) → "Chứng từ".
// Vượt trần: câu của chính luật chặn hiện ngay khi gõ và khoá nút lập.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  api,
  type CompanyBankAccountRow,
  type PaymentVoucherBaseInput,
  type PaymentVoucherInput,
  type PaymentVoucherRow,
  type PaymentVoucherType,
} from "../../../api/client";
import { useAuth } from "../../../auth/useAuth";
import { tien } from "../shared/dinhDang";
import { HangDoiChieu, KhoiForm } from "../shared/KhungFormPhieu";
import { HangTraBang, KhoiChungTuChi, KhoiNguoiNhan, THU_TU_O_MOI, useGoiYNhaCungCap } from "./components/KhoiPhieuChi";
import { KhungFormPhieu, OF, idO, loiNgayChi, nhayToiLoi, type DatO, type LoiForm } from "./components/KhungFormPhieu";
import { BanXemPhieuChi, ONgayChiGon } from "./components/ThanPhieuChiRoi";
import { ChonDotGiao, VoucherAmountFields } from "./components/VoucherAmountFields";
import { taiChungTuSauKhiLap } from "./components/VoucherAttachSection";
import { loiChuyenKhoan } from "./components/VoucherRecipientSection";
import { ChonLoaiPhieu } from "./components/VoucherSegments";
import { cocGoiY, conNoDot, dotGoiY, initialForm, kiemTraPhieuTheoDon, optional } from "./shared/helpers";
import type { LoaiPhieu, PaymentVoucherDialogProps } from "./shared/types";
import "../ke-toan.css";

export function PaymentVoucherDialog({
  purchase,
  voucher = null,
  dotId = null,
  coc = false,
  onClose,
  onSaved,
  onMoTaiKhoan,
}: PaymentVoucherDialogProps & { onMoTaiKhoan?: () => void }) {
  const { token } = useAuth();
  const [form, setForm] = useState<PaymentVoucherBaseInput>(() =>
    initialForm(purchase, voucher, dotId, coc),
  );
  const goc = useRef<string | null>(null);
  const [companyAccounts, setCompanyAccounts] = useState<
    CompanyBankAccountRow[]
  >([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [loiTaiKhoan, setLoiTaiKhoan] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loi, setLoi] = useState<LoiForm>({});
  // Chứng từ đã mua (hóa đơn/biên nhận) chọn lúc lập — upload sau khi create.
  const [files, setFiles] = useState<File[]>([]);
  const [loiTep, setLoiTep] = useState<string | null>(null);
  // Phiếu ĐÃ lập nhưng tệp tải lên hỏng: bấm lại KHÔNG lập phiếu thứ hai, chỉ mở phiếu đã lập.
  const [daLap, setDaLap] = useState<PaymentVoucherRow | null>(null);

  const loai: LoaiPhieu =
    form.payment_stage === "advance" ? "dat_coc" : "thanh_toan";
  const coDotGiao = purchase.deliveries.length > 0;

  // TRẦN khác nhau theo loại phiếu (Đ1/§5.4) — đừng gộp làm một:
  //   · ĐẶT CỌC   → `tran_dat_coc` (giá trị ĐƠN ĐẶT − đã chi ròng): cọc là chi khi hàng CHƯA về,
  //                 nên không thể trói vào số hàng đã giao (= 0 lúc đó).
  //   · THANH TOÁN → CÒN NỢ CỦA CHÍNH ĐỢT ĐANG CHỌN.
  //
  // ⚠️ Trần thanh toán KHÔNG được lấy công nợ cả đơn (lỗi 07/08/2026): kế toán chọn "Đợt 2" rồi
  // gõ số của cả đơn thì phần thừa chảy vào rổ cọc chung và lặng lẽ trả hộ Đợt 1 — món nợ của đợt 1
  // biến mất khỏi màn Công nợ mà không ai bấm gì. Trả cho nhiều đợt thì lập nhiều phiếu.
  //
  // Sửa một phiếu đã chi: số cũ của chính nó đang nằm trong `net_paid` nên đã bị trừ khỏi trần —
  // cộng lại, nếu không mở phiếu ra sửa mỗi dòng nội dung cũng bị báo "vượt trần". Chỉ cộng khi
  // phiếu cũ đóng góp vào ĐÚNG cái trần đang tính (server làm y hệt).
  const maxAmountVnd = useMemo(() => {
    const tran =
      loai === "dat_coc"
        ? purchase.tran_dat_coc
        : conNoDot(purchase, form.delivery_id ?? null);
    const cu = voucher?.status === "paid" ? voucher : null;
    const cuLaCoc = cu?.payment_stage === "advance";
    const cungDich =
      cu != null &&
      (loai === "dat_coc"
        ? cuLaCoc
        : !cuLaCoc && (cu.delivery_id ?? null) === (form.delivery_id ?? null));
    return tran + (cungDich ? cu!.amount_vnd : 0);
  }, [loai, purchase, form.delivery_id, voucher]);
  const amountVnd = useMemo(
    () =>
      Math.round(Number(form.amount || 0) * Number(form.exchange_rate || 0)),
    [form.amount, form.exchange_rate],
  );

  useEffect(() => {
    if (!token) return;
    setLoadingAccounts(true);
    api.accounting.companyAccounts(token, true, "pay")
      .then((company) => {
        setCompanyAccounts(company);
        setForm((current) => {
          const companyAccountId = current.company_bank_account_id ?? null;
          const companyAccount = company.find(
            (row) => row.id === companyAccountId,
          );
          const currency =
            current.voucher_type === "bank_transfer"
              ? (companyAccount?.currency ?? current.currency)
              : current.currency;
          return {
            ...current,
            company_bank_account_id: companyAccountId,
            currency,
            exchange_rate: currency === "VND" ? 1 : current.exchange_rate,
          };
        });
      })
      .catch(() => setLoiTaiKhoan("Không tải được danh sách tài khoản ngân hàng."))
      .finally(() => setLoadingAccounts(false));
  }, [token]);

  // Ảnh chụp form lúc mở (sau khi nạp tài khoản xong) — khác ảnh này là "đang gõ dở".
  useEffect(() => {
    if (!loadingAccounts && goc.current == null) goc.current = JSON.stringify(form);
  }, [loadingAccounts, form]);

  const set: DatO = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
    setLoi((l) => (l[key] ? { ...l, [key]: undefined } : l));
  };

  /** Đổi LOẠI phiếu là đổi cả ba thứ đi kèm: đợt giao, trần, và số tiền điền sẵn.
   *
   * Giữ nguyên số tiền cũ khi đổi loại là bẫy: người chọn "Đặt cọc" với số bằng công nợ rồi bấm
   * lưu, backend nhận đúng nhưng con số không phải thứ họ định. Điền lại theo trần MỚI. */
  function chonLoai(next: LoaiPhieu) {
    if (voucher) return; // sửa phiếu cũ: loại đã chốt, đổi loại là đổi bản chất chứng từ
    setForm((current) => {
      if (next === "dat_coc") {
        return {
          ...current,
          payment_stage: "advance",
          delivery_id: null,
          amount: cocGoiY(purchase),
        };
      }
      return {
        ...current,
        payment_stage: "final",
        delivery_id: coDotGiao ? dotGoiY(purchase) : null,
        amount: conNoDot(purchase, coDotGiao ? dotGoiY(purchase) : null),
      };
    });
    setLoi({});
  }

  function selectType(type: PaymentVoucherType) {
    if (voucher) return;
    setForm((current) => ({
      ...current,
      voucher_type: type,
      currency:
        type === "bank_transfer"
          ? (companyAccounts.find(
              (row) => row.id === current.company_bank_account_id,
            )?.currency ?? current.currency)
          : current.currency,
      exchange_rate:
        type === "bank_transfer" &&
        companyAccounts.find(
          (row) => row.id === current.company_bank_account_id,
        )?.currency === "VND"
          ? 1
          : current.exchange_rate,
      cash_recipient_name:
        type === "cash"
          ? current.cash_recipient_name || purchase.supplier_name || ""
          : current.cash_recipient_name,
    }));
    setLoi({});
  }

  function selectCompanyAccount(value: string) {
    const accountId = value ? Number(value) : null;
    const account = companyAccounts.find((row) => row.id === accountId);
    setForm((current) => ({
      ...current,
      company_bank_account_id: accountId,
      currency: account?.currency ?? current.currency,
      exchange_rate:
        account?.currency === "VND"
          ? 1
          : account && account.currency !== current.currency
            ? 1
            : current.exchange_rate,
    }));
    setLoi((l) => ({ ...l, company_bank_account_id: undefined }));
  }

  /** Mọi luật chặn trước khi gửi — luật tiền ở `kiemTraPhieuTheoDon` (có test), cộng ngày chi và
   *  khối chuyển khoản dùng chung ba form. */
  function kiemTra(): LoiForm {
    const l: LoiForm = kiemTraPhieuTheoDon({ form, loai, coDotGiao, maxAmountVnd, amountVnd });
    const loiNgay = loiNgayChi(form.voucher_date);
    if (loiNgay) l.voucher_date = loiNgay;
    return { ...l, ...loiChuyenKhoan(form) };
  }

  async function submit() {
    if (!token || saving) return;
    if (daLap) {
      onSaved(daLap);
      return;
    }
    const l = kiemTra();
    setLoi(l);
    if (Object.values(l).some(Boolean)) {
      nhayToiLoi(l, THU_TU_O_MOI);
      return;
    }

    const payload: PaymentVoucherBaseInput = {
      ...form,
      amount: Math.round(Number(form.amount)),
      currency: form.currency.trim().toUpperCase(),
      exchange_rate: Number(form.exchange_rate),
      content: form.content.trim(),
      // Cọc KHÔNG gắn đợt (server từ chối nếu gắn); đơn không có đợt nào cũng phải gửi null.
      delivery_id:
        loai === "dat_coc" || !coDotGiao ? null : (form.delivery_id ?? null),
      // DORMANT — luôn gửi null. Hạn trả nay là `due_date` của đợt giao.
      planned_payment_date: null,
      invoice_number: optional(form.invoice_number),
      invoice_date: optional(form.invoice_number) ? optional(form.invoice_date) : null,
      contract_number: optional(form.contract_number),
      cash_recipient_name: optional(form.cash_recipient_name),
      cash_recipient_address: optional(form.cash_recipient_address),
      cash_recipient_identity: optional(form.cash_recipient_identity),
      beneficiary_account_holder: optional(form.beneficiary_account_holder),
      beneficiary_account_number: optional(form.beneficiary_account_number),
      beneficiary_bank_name: optional(form.beneficiary_bank_name),
      beneficiary_bank_branch: optional(form.beneficiary_bank_branch),
      debit_account: optional(form.debit_account),
      credit_account: optional(form.credit_account),
      note: optional(form.note),
      company_bank_account_id:
        form.voucher_type === "bank_transfer"
          ? (form.company_bank_account_id ?? null)
          : null,
      // Tài khoản NCC không còn là danh mục quản lý: UNC lưu ảnh chụp thông tin đã nhập.
      supplier_bank_account_id: null,
      bank_fee_bearer:
        form.voucher_type === "bank_transfer"
          ? (form.bank_fee_bearer ?? "payer")
          : null,
    };
    setSaving(true);
    setError(null);
    try {
      // Đường "duyệt + lập phiếu chi trong một cú bấm" đã BỎ HẲN (chủ 04/08/2026): giám đốc duyệt
      // ở màn Đơn mua hàng trước, kế toán mới lập phiếu chi. Hai chữ ký, hai người.
      //
      // Và KHÔNG có nhánh "sửa" (chủ chốt 07/08/2026): phiếu chi phát hành ra là tiền đã rời két.
      // Sai thì huỷ rồi lập phiếu mới — endpoint PUT bên server cũng đã gỡ.
      const input: PaymentVoucherInput = {
        ...payload,
        purchase_request_id: purchase.id,
      };
      const saved: PaymentVoucherRow = await api.accounting.createVoucher(
        token,
        input,
      );
      if (files.length) {
        const hong = await taiChungTuSauKhiLap(token, saved, files);
        if (hong) {
          setDaLap(saved);
          setError(hong);
          return;
        }
      }
      onSaved(saved);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Không lưu được phiếu chi.",
      );
    } finally {
      setSaving(false);
    }
  }

  const dot = purchase.deliveries.find((d) => d.id === form.delivery_id) ?? null;
  const traDu = loai === "thanh_toan" && dot != null && amountVnd > 0 && amountVnd === dot.con_no;
  // Vượt trần (hoặc hết chỗ chi): câu của chính luật chặn, hiện ngay khi gõ.
  const loiTran =
    amountVnd > 0 && amountVnd > maxAmountVnd
      ? kiemTraPhieuTheoDon({ form, loai, coDotGiao, maxAmountVnd, amountVnd }).amount ?? null
      : null;
  const goiY = useGoiYNhaCungCap(purchase.supplier_id, purchase.supplier_name);

  return (
    <KhungFormPhieu
      duongDan={<>Lập phiếu chi &gt; {purchase.code}</>}
      tieuDe={purchase.supplier_name || purchase.code}
      phuDe={
        <>
          <span className="kt-tag">
            Đơn mua <b>{purchase.code}</b>
          </span>
          {purchase.content && <span className="kt-tag">{purchase.content}</span>}
        </>
      }
      xemTruoc={
        daLap ? (
          <>Phiếu <b>{daLap.code}</b> đã lập.</>
        ) : (
          `${traDu ? "Đợt này sẽ trả đủ. " : ""}Lập xong không sửa được, chỉ hủy được.`
        )
      }
      dangLuu={saving}
      loiChung={error}
      onDong={onClose}
      chanDong={() => !daLap && ((goc.current != null && JSON.stringify(form) !== goc.current) || files.length > 0)}
      onSubmit={() => void submit()}
      nhanNut={daLap ? "Mở phiếu đã lập" : undefined}
      khoaNut={!daLap && !!loiTran}
      banXem={
        <BanXemPhieuChi
          form={{ ...form, amount: loiTran ? 0 : amountVnd, cash_recipient_name: form.cash_recipient_name || purchase.supplier_name }}
          taiKhoan={companyAccounts} soChungTu={files.length} nguon="purchase_request"
          soDot={loai === "thanh_toan" ? dot?.seq_no ?? null : null} />
      }
    >
      <KhoiForm tieu="Đơn mua">
        <HangDoiChieu
          o={[
            { nhan: "Giá trị đơn", giaTri: tien(purchase.total_estimate) },
            { nhan: "Hàng đã giao", giaTri: tien(purchase.gia_tri_da_giao) },
            { nhan: "Đã chi", giaTri: tien(purchase.net_paid) },
            { nhan: "Còn được chi", giaTri: tien(maxAmountVnd), chot: true },
          ]}
        />
        <ChonLoaiPhieu loai={loai} chonLoai={chonLoai} coDotGiao={coDotGiao} purchase={purchase} khoaPhieuCu={!!voucher} />
        {loai === "thanh_toan" && coDotGiao && (
          <ChonDotGiao form={form} purchase={purchase} loi={loi}
            setForm={(next) => {
              setForm(next);
              setLoi((l) => ({ ...l, delivery_id: undefined, amount: undefined }));
            }} />
        )}
      </KhoiForm>

      <KhoiForm tieu="Tiền chi">
        <VoucherAmountFields
          loai={loai}
          coDotGiao={coDotGiao}
          form={form}
          setForm={(next) => {
            setForm(next);
            setLoi((l) => ({ ...l, delivery_id: undefined, amount: undefined, currency: undefined, exchange_rate: undefined }));
          }}
          set={set}
          maxAmountVnd={maxAmountVnd}
          amountVnd={amountVnd}
          loi={loi}
          loiTran={loiTran}
        />
        <HangTraBang form={form} onDoiCach={selectType} loi={loi} taiKhoan={companyAccounts} dangTai={loadingAccounts}
          loiTai={loiTaiKhoan} chonTaiKhoan={selectCompanyAccount} onMoTaiKhoan={onMoTaiKhoan}
          oNgay={<ONgayChiGon form={form} set={set} loi={loi} />} />
      </KhoiForm>

      <KhoiNguoiNhan form={form} set={set} loi={loi} luonCoTen={false} goiY={goiY}>
        <OF khoa="content" nhan="Lý do chi" batBuoc rong loi={loi.content}>
          <input id={idO("content")} value={form.content} aria-invalid={loi.content ? true : undefined}
            onChange={(e) => set("content", e.target.value)} />
        </OF>
      </KhoiNguoiNhan>

      <KhoiChungTuChi form={form} set={set} coHopDong files={files} setFiles={setFiles} loiTep={loiTep} setLoiTep={setLoiTep} />
    </KhungFormPhieu>
  );
}
