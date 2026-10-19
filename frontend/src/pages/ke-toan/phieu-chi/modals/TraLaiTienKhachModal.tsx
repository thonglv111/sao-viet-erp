// Lập PHIẾU CHI TRẢ LẠI TIỀN CHO KHÁCH (12/10/2026) — hai đường vào, cùng một form:
// - Ngăn Công nợ phải thu, nút "Trả lại tiền": số tiền điền sẵn bằng số khách đang dư (đọc sao kê tới
//   hôm nay). Vượt số dư thì chỉ nhắc, không chặn — trả tiền hàng lỗi có thể vượt.
// - Đơn bán đã huỷ, nút "Trả lại cọc": số tiền điền sẵn bằng cọc còn lại; máy chủ chặn vượt cọc còn lại.
// Phiếu thuộc mục cố định "Trả lại tiền cho khách" nên không có ô Mục; tiền vào Công nợ phải thu của
// đúng khách. Thân form dùng chung `ThanPhieuChiRoi` (bố cục chia đôi, tờ phiếu xem trước bên phải).
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ApiError,
  api,
  type CompanyBankAccountRow,
  type PaymentVoucherBaseInput,
  type PaymentVoucherRow,
  type PaymentVoucherType,
} from "../../../../api/client";
import { useAuth } from "../../../../auth/useAuth";
import { homNayVN } from "../../../../utils/ky";
import { tien } from "../../shared/dinhDang";
import { HangDoiChieu, KhoiForm } from "../../shared/KhungFormPhieu";
import { mucCoDinh, useMucThuChi } from "../../shared/OChonMuc";
import { THU_TU_O_MOI } from "../components/KhoiPhieuChi";
import { KhungFormPhieu, loiNgayChi, nhayToiLoi, type DatO, type LoiForm } from "../components/KhungFormPhieu";
import { BanXemPhieuChi, ThanPhieuChiRoi } from "../components/ThanPhieuChiRoi";
import { taiChungTuSauKhiLap } from "../components/VoucherAttachSection";
import { loiChuyenKhoan } from "../components/VoucherRecipientSection";
import { optional } from "../shared/helpers";
import "../../ke-toan.css";

/** `daTraLai` có = khoản dư của đơn hết chỗ ghi hoá đơn (hàng "Chờ trả lại khách", 17/10/2026) —
 *  gồm cả tiền của hoá đơn đã huỷ, nên form gọi là "tiền khách" thay vì "cọc". */
export type DonTraCoc = { id: number; ma: string; daNhan: number; conLai: number; daTraLai?: number };

export function TraLaiTienKhachModal({
  khachId,
  khachTen,
  don,
  onClose,
  onDone,
  onMoTaiKhoan,
  duongDan,
}: {
  khachId: number;
  khachTen: string;
  /** Có = trả lại tiền khách của một đơn. Vắng = khoản trả NGOÀI đơn (vd. hàng lỗi, từ Công nợ phải thu):
   *  tiền khách đang để ở đơn trả theo từng đơn, nên đường này không điền sẵn số nào (17/10/2026). */
  don?: DonTraCoc | null;
  onClose: () => void;
  onDone: (pc: PaymentVoucherRow) => void;
  onMoTaiKhoan?: () => void;
  /** Đường dẫn đầu form khi mở từ nơi khác màn Đơn hàng (vd. Phiếu chi > Chờ trả lại khách). */
  duongDan?: ReactNode;
}) {
  const { token } = useAuth();
  const [form, setForm] = useState<PaymentVoucherBaseInput>(() => ({
    voucher_type: "cash",
    payment_stage: "other",
    voucher_date: homNayVN(),
    amount: don ? Math.max(0, don.conLai) : 0,
    currency: "VND",
    exchange_rate: 1,
    content: don
      ? (don.daTraLai != null ? `Trả lại tiền khách đơn ${don.ma}` : `Trả lại cọc đơn ${don.ma}`)
      : `Trả lại tiền cho ${khachTen}`,
    invoice_date: homNayVN(),
    note: null,
    cash_recipient_name: khachTen,
    cash_recipient_address: null,
    cash_recipient_identity: null,
    company_bank_account_id: null,
    beneficiary_account_holder: khachTen,
    beneficiary_account_number: null,
    beneficiary_bank_name: null,
    beneficiary_bank_branch: null,
    bank_fee_bearer: "payer",
  }));
  const muc = useMucThuChi("chi");
  const tenMuc = mucCoDinh(muc.ds, "customer_refund")?.ten ?? "Trả lại tiền cho khách";
  const goc = useRef(JSON.stringify(form));
  const [tkList, setTkList] = useState<CompanyBankAccountRow[]>([]);
  const [tkDangTai, setTkDangTai] = useState(false);
  const [tkLoi, setTkLoi] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loi, setLoi] = useState<LoiForm>({});
  const [files, setFiles] = useState<File[]>([]);
  const [loiTep, setLoiTep] = useState<string | null>(null);
  const [daLap, setDaLap] = useState<PaymentVoucherRow | null>(null);
  const chuyenKhoan = form.voucher_type === "bank_transfer";

  useEffect(() => {
    if (!chuyenKhoan || !token) return;
    let alive = true;
    setTkDangTai(true);
    api.accounting
      .companyAccounts(token, true, "pay")
      .then((rows) => {
        if (!alive) return;
        setTkList(rows);
        setTkLoi(false);
        if (rows.length === 1) {
          setForm((f) => (f.company_bank_account_id ? f : { ...f, company_bank_account_id: rows[0].id }));
        }
      })
      .catch(() => {
        if (!alive) return;
        setTkList([]);
        setTkLoi(true);
      })
      .finally(() => {
        if (alive) setTkDangTai(false);
      });
    return () => { alive = false; };
  }, [chuyenKhoan, token]);

  const set: DatO = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
    setLoi((l) => (l[key] ? { ...l, [key]: undefined } : l));
  };

  function chonCach(v: PaymentVoucherType) {
    set("voucher_type", v);
    setLoi({});
  }

  const soTien = Math.round(Number(form.amount)) || 0;
  const laTien = don?.daTraLai != null;
  const vuotCoc = don && soTien > don.conLai
    ? `Vượt phần ${laTien ? "tiền khách" : "cọc"} còn lại của đơn (${tien(don.conLai)}).` : null;

  function kiemTra(): LoiForm {
    const l: LoiForm = {};
    if (!(soTien > 0)) l.amount = "Số tiền trả lại phải lớn hơn 0.";
    if (!form.cash_recipient_name?.trim()) l.cash_recipient_name = "Nhập người nhận tiền.";
    if (!form.content.trim()) l.content = "Ghi lý do chi.";
    const loiNgay = loiNgayChi(form.voucher_date);
    if (loiNgay) l.voucher_date = loiNgay;
    return { ...l, ...loiChuyenKhoan(form) };
  }

  async function save() {
    if (!token || busy) return;
    if (daLap) {
      onDone(daLap);
      return;
    }
    const l = kiemTra();
    setLoi(l);
    if (Object.values(l).some(Boolean)) {
      nhayToiLoi(l, THU_TU_O_MOI);
      return;
    }
    if (vuotCoc) return;
    setBusy(true);
    setErr(null);
    try {
      const pc = await api.accounting.createVoucher(token, {
        source_type: "customer_refund",
        customer_id: khachId,
        order_id: don?.id ?? null,
        voucher_type: form.voucher_type,
        payment_stage: "other",
        voucher_date: form.voucher_date,
        amount: soTien,
        currency: "VND",
        exchange_rate: 1,
        content: form.content.trim(),
        note: optional(form.note),
        invoice_number: optional(form.invoice_number),
        invoice_date: optional(form.invoice_number) ? optional(form.invoice_date) : null,
        cash_recipient_name: (form.cash_recipient_name ?? "").trim(),
        cash_recipient_address: chuyenKhoan ? null : optional(form.cash_recipient_address),
        cash_recipient_identity: chuyenKhoan ? null : optional(form.cash_recipient_identity),
        company_bank_account_id: chuyenKhoan ? Number(form.company_bank_account_id) : null,
        beneficiary_account_holder: chuyenKhoan ? (form.beneficiary_account_holder ?? "").trim() : null,
        beneficiary_account_number: chuyenKhoan ? (form.beneficiary_account_number ?? "").trim() : null,
        beneficiary_bank_name: chuyenKhoan ? (form.beneficiary_bank_name ?? "").trim() : null,
        beneficiary_bank_branch: chuyenKhoan ? optional(form.beneficiary_bank_branch) : null,
        bank_fee_bearer: chuyenKhoan ? "payer" : null,
      });
      if (files.length) {
        const hong = await taiChungTuSauKhiLap(token, pc, files);
        if (hong) {
          setDaLap(pc);
          setErr(hong);
          setBusy(false);
          return;
        }
      }
      onDone(pc);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
      setBusy(false);
    }
  }

  // Dòng nhắc dưới ô số tiền: đường công nợ so với số khách đang dư (chỉ nhắc), đường đơn đã có `vuot`
  // — đang báo vượt thì thôi nhắc, khỏi nói một ý hai lần.
  const nhac = don
    ? vuotCoc ? null : `Không vượt phần ${laTien ? "tiền khách" : "cọc"} còn lại của đơn.`
    : "Khoản trả ngoài đơn, ví dụ tiền hàng lỗi. Số này cộng nợ lại vào hoá đơn hạn muộn nhất của khách. Tiền khách đang để ở đơn thì trả lại ở từng đơn.";

  return (
    <KhungFormPhieu
      duongDan={duongDan ?? (don
        ? <>Đơn hàng {don.ma} &gt; {laTien ? "Trả lại tiền khách" : "Trả lại cọc"}</>
        : <>Công nợ phải thu &gt; {khachTen} &gt; Trả lại tiền</>)}
      tieuDe="Trả lại tiền cho khách"
      phuDe={
        <span className="kt-tag">
          Khách hàng <b>{khachTen}</b>
        </span>
      }
      xemTruoc={daLap ? <>Phiếu <b>{daLap.code}</b> đã lập.</> : "Lập xong không sửa được, chỉ hủy được."}
      dangLuu={busy}
      loiChung={err}
      onDong={onClose}
      chanDong={() => !daLap && (JSON.stringify(form) !== goc.current || files.length > 0)}
      onSubmit={() => void save()}
      nhanNut={daLap ? "Mở phiếu đã lập" : undefined}
      banXem={<BanXemPhieuChi form={form} taiKhoan={tkList} soChungTu={files.length} nguon="customer_refund" tenMuc={tenMuc} />}
    >
      <KhoiForm tieu={don ? (laTien ? "Tiền khách của đơn" : "Cọc của đơn") : "Khách hàng"}>
        <HangDoiChieu
          o={don && laTien
            ? [
                { nhan: "Đơn", giaTri: don.ma },
                { nhan: "Đã trả lại", giaTri: tien(don.daTraLai ?? 0) },
                { nhan: "Còn phải trả lại", giaTri: tien(don.conLai), chot: true },
              ]
            : don
            ? [
                { nhan: "Đơn", giaTri: don.ma },
                { nhan: "Cọc đã nhận", giaTri: tien(don.daNhan) },
                { nhan: "Cọc còn lại", giaTri: tien(don.conLai), chot: true },
              ]
            : [
                { nhan: "Khách", giaTri: khachTen, chot: true },
              ]}
        />
      </KhoiForm>
      <ThanPhieuChiRoi form={form} set={set} loi={loi} onDoiCach={chonCach} taiKhoan={tkList}
        dangTai={tkDangTai}
        loiTai={
          tkLoi
            ? "Không đọc được danh sách tài khoản công ty (thiếu quyền Tài khoản ngân hàng). Chọn Tiền mặt, hoặc nhờ kế toán có quyền lập giúp."
            : null
        }
        onMoTaiKhoan={onMoTaiKhoan}
        files={files} setFiles={setFiles} loiTep={loiTep} setLoiTep={setLoiTep}
        goiSoTien={nhac}
        vuot={vuotCoc}
        nutDu={don ? { nhan: laTien ? "Trả hết số còn lại" : "Trả hết cọc còn lại", so: don.conLai } : undefined}
        goiY={[{ ten: khachTen, phu: "khách hàng" }]} />
    </KhungFormPhieu>
  );
}
