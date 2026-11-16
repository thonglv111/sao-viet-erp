// Lập PHIẾU CHI thuê gia công từ NHIỀU phiếu nhận cùng nhà gia công (spec Thuê gia công 2026-11-13
// §4.6, Q3). Dùng CHUNG thân form với nút "Lập phiếu chi" trên đầu màn (`ThanPhieuChiRoi`), thêm khối
// đầu "Phiếu nhận" (Phiếu | Đạt | Hỏng | Tạm tính). Số tiền điền sẵn = Σ tạm tính, sửa theo hoá đơn
// thật; lệch thì bắt ghi lý do. Không có ô nhà cung cấp công nợ — phiếu này không vào 331.
import { useEffect, useRef, useState } from "react";
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
import { Cum, TheNho } from "../../shared/Cum";
import { HangDoiChieu, KhoiForm, OF, idO } from "../../shared/KhungFormPhieu";
import { THU_TU_O_MOI } from "../components/KhoiPhieuChi";
import { KhungFormPhieu, loiNgayChi, nhayToiLoi, type DatO, type LoiForm } from "../components/KhungFormPhieu";
import { mucCoDinh, useMucThuChi } from "../../shared/OChonMuc";
import { BanXemPhieuChi, ThanPhieuChiRoi } from "../components/ThanPhieuChiRoi";
import { taiChungTuSauKhiLap } from "../components/VoucherAttachSection";
import { loiChuyenKhoan } from "../components/VoucherRecipientSection";
import type { TgcChoTraTien } from "../../../../api/thueGiaCong";
import { tien } from "../../shared/dinhDang";
import { congDong, lyDoChiGiaCong, motDonVi, soDv, tongTamTinh } from "../shared/giaCong";
import { optional } from "../shared/helpers";
import "../../ke-toan.css";
import "../../../thue-gia-cong/thue-gia-cong.css";

export function LapPhieuChiGiaCongModal({
  rows,
  onClose,
  onDone,
  onMoTaiKhoan,
}: {
  rows: TgcChoTraTien[];
  onClose: () => void;
  onDone: (pc: PaymentVoucherRow) => void;
  onMoTaiKhoan?: () => void;
}) {
  const { token } = useAuth();
  const nha = rows[0]?.nha_cung_cap_ten ?? "";
  const tong = tongTamTinh(rows);
  const [lyDoLech, setLyDoLech] = useState("");
  const [loiLech, setLoiLech] = useState<string | null>(null);
  const [form, setForm] = useState<PaymentVoucherBaseInput>(() => ({
    voucher_type: "cash",
    payment_stage: "other",
    voucher_date: homNayVN(),
    // Điền sẵn Σ tạm tính của các phiếu nhận; kế toán sửa theo hoá đơn thật.
    amount: tong,
    currency: "VND",
    exchange_rate: 1,
    content: lyDoChiGiaCong(rows),
    // Chứng từ gốc thường mang ngày hôm nay — điền sẵn, chỉ gửi đi khi có Số chứng từ.
    invoice_date: homNayVN(),
    note: null,
    cash_recipient_name: nha,
    cash_recipient_address: null,
    cash_recipient_identity: null,
    company_bank_account_id: null,
    beneficiary_account_holder: nha,
    beneficiary_account_number: null,
    beneficiary_bank_name: null,
    beneficiary_bank_branch: null,
    bank_fee_bearer: "payer",
  }));
  const muc = useMucThuChi("chi");
  // Phiếu gia công thuộc mục CỐ ĐỊNH "Thuê gia công ngoài" — không có ô Mục, tờ xem trước ghi tên.
  const tenMuc = mucCoDinh(muc.ds, "gia_cong_ngoai")?.ten;
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

  // Chỉ nạp tài khoản công ty khi chọn chuyển khoản — API này đòi quyền Tài khoản ngân hàng.
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

  function kiemTra(): LoiForm {
    const l: LoiForm = {};
    if (!(Math.round(Number(form.amount)) > 0)) l.amount = "Số tiền chi phải lớn hơn 0.";
    if (!form.cash_recipient_name?.trim()) l.cash_recipient_name = "Nhập người nhận tiền.";
    if (!form.content.trim()) l.content = "Ghi lý do chi.";
    const loiNgay = loiNgayChi(form.voucher_date);
    if (loiNgay) l.voucher_date = loiNgay;
    return { ...l, ...loiChuyenKhoan(form) };
  }

  const lech = Math.round(Number(form.amount)) !== tong;

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
    if (lech && lyDoLech.trim().length < 3) {
      setLoiLech("Số tiền lệch tạm tính — ghi lý do (ít nhất 3 ký tự).");
      document.getElementById(idO("ly_do_lech"))?.focus();
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const pc = await api.accounting.createVoucher(token, {
        source_type: "gia_cong_ngoai",
        tgc_phieu_nhan_ids: rows.map((r) => r.phieu_nhan_id),
        ly_do_lech: lech ? lyDoLech.trim() : null,
        voucher_type: form.voucher_type,
        payment_stage: "other",
        voucher_date: form.voucher_date,
        amount: Math.round(Number(form.amount)),
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
      // 409 (phiếu nhận đã có phiếu chi) và 400/422 (khác nhà, huỷ, lệch thiếu lý do) — câu của máy chủ.
      setErr(e instanceof ApiError ? e.message : String(e));
      setBusy(false);
    }
  }

  // Cùng giao diện với nút "Lập phiếu chi" trên đầu màn (`ThanPhieuChiRoi`), thêm khối phiếu nhận.
  return (
    <KhungFormPhieu
      duongDan={<>Phiếu chi &gt; Lập mới &gt; Thuê gia công {rows.map((r) => r.ma).join(" ")}</>}
      tieuDe="Lập phiếu chi"
      phuDe={
        <span className="kt-tag">
          Nhà gia công <b>{nha}</b>
        </span>
      }
      xemTruoc={daLap ? <>Phiếu <b>{daLap.code}</b> đã lập.</> : "Lập xong không sửa được, chỉ hủy được."}
      dangLuu={busy}
      loiChung={err}
      onDong={onClose}
      chanDong={() => !daLap && (JSON.stringify(form) !== goc.current || files.length > 0 || !!lyDoLech)}
      onSubmit={() => void save()}
      nhanNut={daLap ? "Mở phiếu đã lập" : undefined}
      banXem={<BanXemPhieuChi form={form} taiKhoan={tkList} soChungTu={files.length} nguon="gia_cong_ngoai" tenMuc={tenMuc} />}
    >
      <KhoiForm tieu="Phiếu nhận">
        <table className="tgc-bang" aria-label="Phiếu nhận trả tiền">
          <thead>
            <tr><th>Phiếu</th><th>Việc</th><th className="n">Đạt</th><th className="n">Hỏng</th><th className="n">Tạm tính</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const dv = motDonVi(r.dong);
              return (
                <tr key={r.phieu_nhan_id}>
                  <td>{r.ma}</td>
                  <td><Cum>{r.dong.map((d, i) => <TheNho key={`${d.ten_viec}-${i}`}>{d.ten_viec}</TheNho>)}</Cum></td>
                  <td className="n">{dv === undefined
                    ? r.dong.map((d, i) => <span key={i} className="tgc-u">{soDv(d.dat, d.don_vi)}</span>)
                    : soDv(congDong(r.dong, "dat"), dv)}</td>
                  <td className="n">{congDong(r.dong, "hong") > 0 ? congDong(r.dong, "hong").toLocaleString("vi-VN") : "—"}</td>
                  <td className="n">{tien(r.tam_tinh)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <HangDoiChieu o={[{ nhan: "Tạm tính", giaTri: tien(tong), chot: true }]} />
        {lech && (
          <OF khoa="ly_do_lech" nhan="Lý do lệch tạm tính" batBuoc rong loi={loiLech ?? undefined}
            goi={`Số tiền ${tien(Math.round(Number(form.amount)))} khác tạm tính ${tien(tong)}.`}>
            <input id={idO("ly_do_lech")} value={lyDoLech} placeholder="Ví dụ: trừ hàng hỏng theo hoá đơn"
              onChange={(e) => { setLyDoLech(e.target.value); setLoiLech(null); }} />
          </OF>
        )}
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
        goiSoTien="Điền sẵn tạm tính, sửa theo hoá đơn của nhà gia công."
        goiY={[{ ten: nha, phu: "nhà gia công" }]} />
    </KhungFormPhieu>
  );
}
