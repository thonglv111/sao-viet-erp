// Tab Lương & BHXH của hồ sơ nhân sự (tách từ pages/NhanSuPage.tsx).
import { useState } from "react";
import {
  api,
  PIT_MODE_META,
  PIT_MODE_ORDER,
  type EmployeeDetail,
  type EmployeeInput,
  type PitMode,
} from "../../../../api/client";
import { Button } from "../../../../components/Button";
import { Check, Copy, CreditCard, FileText, Users } from "lucide-react";
import { errMsg } from "../shared/helpers";
import { Field } from "../components/form-fields";
import { CommissionCard, type HoaHongState } from "../components/badges";
import { InfoCard, InfoField } from "../components/info-display";

// Tab Lương & BHXH — dữ liệu nhạy cảm (chỉ hiện với quyền `nhan_su:view_salary`).
// Khoản thu nhập gán theo TỪNG NGƯỜI: Lương → Lương nhân viên → Sửa lương → "+ Thêm khoản thu
// nhập" (CHỌN từ danh mục — màn nhân sự không có đường tạo khoản mới).
// Cách tính thuế TNCN (`pit_mode`) khai ở ĐÂY, cạnh Người phụ thuộc — cùng là dữ liệu thuế của hồ
// sơ, cùng quyền `nhan_su:edit_salary`. Trước 31/10/2026 dòng gợi ý chỉ sang Sửa lương, nhưng khối
// chọn ở đó đã bị ẩn từ 03/08 ⇒ không còn đường nào đổi được ngoài Nhập Excel.
export function SalaryTab({
  token,
  emp,
  edit,
  setEdit,
  onSaved,
  hoaHong,
}: {
  token: string;
  emp: EmployeeDetail;
  edit: boolean;
  setEdit: (e: boolean) => void;
  onSaved: () => void;
  /** % hoa hồng do KHAY tải một lần (`useHoaHong`) — tab chỉ hiển thị, Sửa/Huỷ không tải lại. */
  hoaHong: HoaHongState;
}) {
  const [form, setForm] = useState<EmployeeInput>({
    ...emp,
  } as unknown as EmployeeInput);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  function set<K extends keyof EmployeeInput>(k: K, v: EmployeeInput[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.employees.update(token, emp.id, form);
      setEdit(false);
      onSaved();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  if (edit) {
    return (
      <div>
        {error && <div className="banner banner--error">{error}</div>}
        <div className="ns-grid">
          <Field label="Số sổ BHXH">
            <input
              value={form.social_insurance_no ?? ""}
              onChange={(e) => set("social_insurance_no", e.target.value)}
            />
          </Field>
          <Field label="MST cá nhân">
            <input
              value={form.pit_tax_code ?? ""}
              onChange={(e) => set("pit_tax_code", e.target.value)}
            />
          </Field>
          <Field
            label="Người phụ thuộc"
            hint="Mỗi người phụ thuộc được giảm trừ thêm khi tính thuế TNCN (mức lấy ở Cấu hình lương)."
          >
            <input
              type="number"
              min={0}
              value={form.dependents_count ?? 0}
              onChange={(e) => set("dependents_count", Number(e.target.value))}
            />
          </Field>
          <Field
            label="Cách tính thuế TNCN"
            hint={form.pit_mode ? PIT_MODE_META[form.pit_mode as PitMode].hint : undefined}
          >
            <select
              value={form.pit_mode ?? "luy_tien"}
              onChange={(e) => set("pit_mode", e.target.value as PitMode)}
            >
              {PIT_MODE_ORDER.map((m) => (
                <option key={m} value={m}>
                  {PIT_MODE_META[m].label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Số tài khoản">
            <input
              value={form.bank_account ?? ""}
              onChange={(e) => set("bank_account", e.target.value)}
            />
          </Field>
          <Field label="Ngân hàng">
            <input
              value={form.bank_name ?? ""}
              onChange={(e) => set("bank_name", e.target.value)}
            />
          </Field>
        </div>
        <div className="ns2-editfoot">
          <button
            className="btn btn--ghost"
            onClick={() => setEdit(false)}
            disabled={busy}
          >
            Hủy
          </button>
          {/* Hành động chính của form đang mở → cam. Mỗi tab chỉ có ĐÚNG một nút Lưu nên
              khay hồ sơ không bao giờ hiện hai nút cam cùng lúc. */}
          <Button variant="accent" onClick={save} loading={busy}>
            {busy ? "Đang lưu…" : "Lưu"}
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div>
      <div className="ns-info-sections">
        {/* Cột trái xếp chồng Hoa hồng + Nhận lương — thẻ Ngân hàng một ô trải hết khay để trống
            nửa thẻ, nên chui xuống dưới Hoa hồng (mockup docs/mockups/ho-so-luong-ngan-hang-3-phuong-an.html, B). */}
        <div>
          <CommissionCard state={hoaHong} />
          <InfoCard title="Nhận lương" icon={CreditCard}>
            <TheNhanLuong soTk={emp.bank_account} nganHang={emp.bank_name} />
          </InfoCard>
        </div>
        <InfoCard title="BHXH / TNCN" icon={FileText}>
          <InfoField
            label="Số sổ BHXH"
            value={emp.social_insurance_no}
            icon={FileText}
          />
          <InfoField
            label="MST cá nhân"
            value={emp.pit_tax_code}
            icon={FileText}
          />
          <InfoField
            label="Người phụ thuộc"
            value={String(emp.dependents_count)}
            icon={Users}
          />
          <InfoField
            label="Cách tính thuế TNCN"
            value={emp.pit_mode ? PIT_MODE_META[emp.pit_mode].label : null}
            icon={FileText}
            hint="Đổi bằng nút Sửa lương & BHXH ở trên."
          />
        </InfoCard>
      </div>
    </div>
  );
}

// Nhóm số tài khoản 4-3-3… cho dễ đọc khi đọc qua điện thoại; Sao chép vẫn ra chuỗi gốc.
function nhomSoTk(s: string): string {
  return /^\d{8,}$/.test(s) ? s.replace(/^(\d{4})(\d{3})/, "$1 $2 ").replace(/(\d{3})(?=\d{4,})/g, "$1 ") : s;
}

// Ô Ngân hàng đang gõ tự do. Kiểu "MB - Ngân hàng TMCP Quân đội" thì tách được chữ viết tắt;
// không có dấu "-" thì hiện biểu tượng thẻ, đừng đoán chữ viết tắt.
function tachNganHang(s: string | null): { vietTat: string | null; ten: string | null } {
  const t = (s ?? "").trim();
  if (!t) return { vietTat: null, ten: null };
  const m = t.match(/^(\S{1,8})\s+-\s+(.+)$/);
  return m ? { vietTat: m[1].toUpperCase(), ten: m[2] } : { vietTat: null, ten: t };
}

function TheNhanLuong({ soTk, nganHang }: { soTk: string | null; nganHang: string | null }) {
  const [daChep, setDaChep] = useState(false);
  const { vietTat, ten } = tachNganHang(nganHang);
  if (!soTk) {
    return (
      <div className="ns-pay ns-pay--trong">
        <div className="ns-pay__mono ns-pay__mono--trong">
          <CreditCard size={18} />
        </div>
        <div className="ns-pay__main">
          <span className="ns-pay__trong">Chưa khai tài khoản nhận lương</span>
          {ten && <span className="ns-pay__bank">{ten}</span>}
        </div>
      </div>
    );
  }
  function chep() {
    navigator.clipboard?.writeText(soTk!).catch(() => {});
    setDaChep(true);
    setTimeout(() => setDaChep(false), 1500);
  }
  return (
    <div className="ns-pay">
      <div className="ns-pay__mono" aria-hidden="true">
        {vietTat ?? <CreditCard size={18} />}
      </div>
      <div className="ns-pay__main">
        <span className="ns-pay__acc">{nhomSoTk(soTk)}</span>
        <span className="ns-pay__bank">{ten ?? "Chưa ghi ngân hàng"}</span>
      </div>
      <button
        type="button"
        className={`ns-pay__copy${daChep ? " is-copied" : ""}`}
        onClick={chep}
        aria-label="Sao chép số tài khoản"
      >
        {daChep ? <Check size={12} /> : <Copy size={12} />}
        {daChep ? "Đã chép" : "Sao chép"}
      </button>
    </div>
  );
}
