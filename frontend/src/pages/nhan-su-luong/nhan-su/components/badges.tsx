// Badge trạng thái · dải KPI · thẻ hoa hồng (tách từ pages/NhanSuPage.tsx).
import { useEffect, useState } from "react";
import { api, ApiError, type EmployeeKpis } from "../../../../api/client";
import {
  AlertCircle,
  Hourglass,
  TrendingUp,
  UserCheck,
  Users,
} from "lucide-react";
import { STATUS_CLASS, STATUS_LABEL } from "../shared/constants";
import { InfoCard, InfoField } from "./info-display";

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`ns-badge ${STATUS_CLASS[status] ?? "ns-badge--muted"}`}>
      <span className="ns-badge-dot" />
      <span>{STATUS_LABEL[status] ?? status}</span>
    </span>
  );
}

export function KpiStrip({
  kpis,
  statusFilter,
  endingSoon,
  onPickAll,
  onPickProbation,
  onPickProbationEnded,
  onPickActive,
  onPickEndingSoon,
}: {
  kpis: EmployeeKpis;
  statusFilter: string;
  endingSoon: boolean;
  onPickAll: () => void;
  onPickProbation: () => void;
  onPickProbationEnded: () => void;
  onPickActive: () => void;
  onPickEndingSoon: () => void;
}) {
  const isAllActive = statusFilter === "" && !endingSoon;
  const isProbationActive = statusFilter === "probation" && !endingSoon;
  const isProbationEndedActive = statusFilter === "probation_ended" && !endingSoon;
  const isActiveActive = statusFilter === "active" && !endingSoon;
  const isEndingSoonActive = endingSoon;

  // "Sắp hết thử việc" = 0 thì KHÔNG tô cảnh báo: màu để dành cho lúc thật sự có việc.
  const endingSoonCount = kpis.probation_ending_soon;

  return (
    <div className="ns2__kpis" role="group" aria-label="Lọc nhanh theo trạng thái">
      <button
        type="button"
        className={`ns__kpi${isAllActive ? " is-active" : ""}`}
        onClick={onPickAll}
        aria-pressed={isAllActive}
        title="Xem tất cả nhân sự"
      >
        <Users size={13} aria-hidden="true" />
        <span className="ns__kpilabel">Tất cả</span>
        <span className="ns__kpival">{kpis.total}</span>
      </button>

      <button
        type="button"
        className={`ns__kpi${isProbationActive ? " is-active" : ""}`}
        onClick={onPickProbation}
        aria-pressed={isProbationActive}
        title="Chỉ xem người đang thử việc"
      >
        <Hourglass size={13} aria-hidden="true" />
        <span className="ns__kpilabel">Thử việc</span>
        <span className="ns__kpival">{kpis.probation}</span>
      </button>

      {/* Ô VIỆC TỒN: chỉ hiện khi có người thật sự đang chờ. Đây là cái duy nhất nhắc HCNS rằng
          có người đã hết hạn mà chưa ai bấm — 0 người thì giấu đi cho đỡ rác. */}
      {kpis.probation_ended > 0 && (
        <button
          type="button"
          className={`ns__kpi ns__kpi--due${isProbationEndedActive ? " is-active" : ""}`}
          onClick={onPickProbationEnded}
          aria-pressed={isProbationEndedActive}
          title="Đã hết thử việc, chờ bấm Chuyển chính thức"
        >
          <UserCheck size={13} aria-hidden="true" />
          <span className="ns__kpilabel">Chờ xác nhận</span>
          <span className="ns__kpival">{kpis.probation_ended}</span>
        </button>
      )}

      <button
        type="button"
        className={`ns__kpi${isActiveActive ? " is-active" : ""}`}
        onClick={onPickActive}
        aria-pressed={isActiveActive}
        title="Chỉ xem người đã chính thức"
      >
        <UserCheck size={13} aria-hidden="true" />
        <span className="ns__kpilabel">Chính thức</span>
        <span className="ns__kpival">{kpis.active}</span>
      </button>

      {/* Tách sang phải: đây là ô DUY NHẤT đòi người làm gì đó, không xếp lẫn 3 ô đếm kia. */}
      <button
        type="button"
        className={`ns__kpi ${isEndingSoonActive ? " is-active" : ""}`}
        onClick={onPickEndingSoon}
        aria-pressed={isEndingSoonActive}
        title={
          endingSoonCount === 0
            ? "Chưa có ai sắp hết thử việc trong 30 ngày tới"
            : `${endingSoonCount} người hết thử việc trong 30 ngày tới — cần quyết định ký chính thức`
        }
      >
        <AlertCircle size={13} aria-hidden="true" />
        <span className="ns__kpilabel">Sắp hết thử việc</span>
        <span className="ns__kpival">{endingSoonCount}</span>
      </button>
    </div>
  );
}

export type HoaHongState =
  | { kind: "loading" }
  | { kind: "forbidden" }
  | { kind: "ok"; pct: string | null }
  | { kind: "error" };

/** Tải % hoa hồng MỘT lần cho mỗi hồ sơ — gọi ở KHAY (EmployeeDetailPanel), không ở thẻ.
 *  Trước đây thẻ tự tải khi mount: bấm Sửa rồi Huỷ/Lưu là gỡ rồi gắn lại thẻ ⇒ kéo lại cả lịch sử
 *  lương; và tải chỉ bắt đầu khi bấm sang tab nên thẻ hiện SAU, đẩy khối Nhận lương tụt xuống.
 *  Nay tải song song với hồ sơ ngay lúc mở khay. `enabled=false` (không có quyền xem hồ sơ lương
 *  bên Lương) ⇒ không gọi, coi như `forbidden` — khỏi đẻ một request chắc chắn 403. */
export function useHoaHong(token: string, employeeId: number, enabled: boolean): HoaHongState {
  const [state, setState] = useState<HoaHongState>(
    enabled ? { kind: "loading" } : { kind: "forbidden" },
  );
  useEffect(() => {
    if (!enabled) {
      setState({ kind: "forbidden" });
      return;
    }
    let alive = true;
    setState({ kind: "loading" });
    api.luong
      .salaries(token, employeeId)
      .then((r) => {
        if (!alive) return;
        const latest = r.items.length
          ? [...r.items].sort((a, b) =>
              b.effective_from.localeCompare(a.effective_from),
            )[0]
          : null;
        // Biểu bậc theo số ngày thu (23/10/2026): một bậc thì hiện %, nhiều bậc thì nói số bậc.
        const bac = latest?.bac_hoa_hong ?? [];
        const pct = bac.length === 1 ? `${+(bac[0].pct * 100).toFixed(4)}% mọi số ngày thu`
          : bac.length > 1 ? `Theo ${bac.length} bậc số ngày thu` : null;
        setState({ kind: "ok", pct });
      })
      .catch((e) => {
        if (!alive) return;
        // 403 ⇒ ẨN HẲN thẻ. Hiện "—" là NÓI DỐI: "—" nghĩa là chưa khai, còn ở đây là mình
        // không được phép biết — người xem sẽ kết luận nhầm là NV không có hoa hồng.
        if (e instanceof ApiError && e.status === 403)
          setState({ kind: "forbidden" });
        else setState({ kind: "error" });
      });
    return () => {
      alive = false;
    };
  }, [token, employeeId, enabled]);
  return state;
}

/** % hoa hồng của NV kinh doanh — CHỈ ĐỌC ở đây, sửa ở Lương → Lương nhân viên → Sửa lương.
 *  Không cho sửa tại drawer vì `POST /api/luong/salaries/{id}` luôn đẻ một mốc lương MỚI với
 *  TOÀN BỘ các số; drawer không giữ `luong_vi_tri`/phụ cấp nên post từ đây là lương về 0.
 *  Chỉ HIỂN THỊ — số do `useHoaHong` ở khay tải. Đang tải vẫn vẽ thẻ để giữ chỗ (trả `null` là
 *  khối bên dưới hiện trước rồi bị đẩy tụt xuống). */
export function CommissionCard({ state }: { state: HoaHongState }) {
  if (state.kind === "forbidden") return null;
  const pct = state.kind === "ok" ? state.pct : null;
  return (
    <InfoCard title="Hoa hồng kinh doanh" icon={TrendingUp}>
      <InfoField
        label="Biểu hoa hồng"
        value={state.kind === "loading" ? "Đang tải…" : pct}
        icon={TrendingUp}
        hint={
          "Máy tự tính hoa hồng theo tiền thu về trong kỳ, % theo số ngày thu (biểu chụp vào đơn lúc chốt) — ĐỪNG thêm tay khoản hoa hồng ở bảng lương, là trả hai lần. Đổi biểu ở Lương → Lương nhân viên." +
          (state.kind === "error" ? " Không đọc được số hoa hồng." : "")
        }
      />
    </InfoCard>
  );
}
