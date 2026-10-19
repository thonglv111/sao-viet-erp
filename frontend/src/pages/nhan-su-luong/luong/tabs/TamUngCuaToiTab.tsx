// Tab Tạm ứng của tôi (tách từ pages/LuongPage.tsx).
import { useCallback, useEffect, useState } from "react";
import { Wallet } from "lucide-react";
import { ApiError, api, type MyAdvances } from "../../../../api/client";
import { EmptyState } from "../../../../components/EmptyState";
import { printAdvanceRequest } from "../../../../utils/printAdvanceRequest";
import { RowActionButton } from "../../../../components/RowActionButton";
import { advPrintData, money } from "../shared/helpers";
import { MyAdvanceModal } from "../modals/MyAdvanceModal";
// Nhãn trạng thái / loại DÙNG CHUNG với tab Tạm ứng — bản riêng cũ thiếu "Đã chi" nên hiện mã "paid".
import { KIND, STATUS } from "./TamUngHanhDong";

// --- Tab: Tạm ứng của tôi (self-service — nhân viên tự đề nghị) --------------

export function TamUngCuaToiTab({
  token,
  eventTick,
  canCreate,
}: {
  token: string;
  eventTick?: number;
  /** Ô THAO TÁC của màn Lương. Không có ô thì KHÔNG bày nút — bày ra mà bấm ăn 403 thì
   *  trông như hệ thống hỏng, chứ không như "anh không có quyền" (chủ chốt 15/08/2026). */
  canCreate: boolean;
}) {
  const [data, setData] = useState<MyAdvances | null>(null);
  const [adding, setAdding] = useState<null | "tam_ung" | "luong_dot_1">(null);

  // Lỗi mạng KHÔNG được biến thành "chưa gắn hồ sơ" (trước đây catch dựng `has_employee: false`
  // ⇒ người có hồ sơ đọc thấy câu sai, đi hỏi HCNS). Lỗi là lỗi, có nút Thử lại.
  const [loi, setLoi] = useState<string | null>(null);
  const load = useCallback(() => {
    api.luong
      .myAdvances(token)
      .then((d) => {
        setData(d);
        setLoi(null);
      })
      .catch((e: unknown) =>
        setLoi(e instanceof ApiError ? e.message : "Không đọc được danh sách tạm ứng."),
      );
  }, [token]);
  useEffect(() => {
    load();
  }, [load, eventTick]);

  if (!data && loi) return <EmptyState trangThai="loi" loi={loi} onThuLai={load} />;
  if (!data) return <EmptyState trangThai="dang-tai" />;
  if (!data.has_employee)
    return (
      <div className="lg-table-empty-state">
        <div className="lg-table-empty-icon">
          <Wallet size={20} />
        </div>
        <span className="lg-table-empty-title">
          Tài khoản chưa gắn hồ sơ nhân sự
        </span>
        <span className="lg-table-empty-desc">
          Liên hệ HCNS để liên kết tài khoản với hồ sơ, sau đó mới lập đề nghị
          tạm ứng được.
        </span>
      </div>
    );
  return (
    <div>
      {loi && (
        <div className="banner banner--error" role="alert">
          <span>{loi}</span>
          <button type="button" className="btn btn--ghost" onClick={load}>
            Thử lại
          </button>
        </div>
      )}
      <div className="cc-toolbar lg-toolbar lg-toolbar--sat">
        {canCreate && (
          <button
            className="btn btn--primary"
            onClick={() => setAdding("tam_ung")}
          >
            + Đề nghị tạm ứng
          </button>
        )}
        {canCreate && (
          <button
            className="btn btn--ghost"
            onClick={() => setAdding("luong_dot_1")}
          >
            + Xin lương đợt 1
          </button>
        )}
        <span className="cc-card__hint">
          {canCreate
            ? "Đề nghị gửi tới kế toán duyệt; bấm “In phiếu” để ký & nộp."
            : "Chỉ xem — vai của bạn chưa được bật ô Thao tác ở màn Lương nên không gửi đề nghị được."}
        </span>
      </div>
      {data.items.length === 0 ? (
        <div className="lg-table-empty-state">
          <div className="lg-table-empty-icon">
            <Wallet size={20} />
          </div>
          <span className="lg-table-empty-title">Chưa có đề nghị tạm ứng</span>
          <span className="lg-table-empty-desc">
            Nhấp “+ Đề nghị tạm ứng” để lập phiếu gửi kế toán.
          </span>
        </div>
      ) : (
        <div className="lg-emp-table-wrapper">
          <table className="ns__table">
            <thead>
              <tr>
                <th>Mã</th>
                <th>Loại</th>
                <th>Kỳ</th>
                <th>Ngày ứng</th>
                <th className="lg-num">Số tiền</th>
                <th>Lý do</th>
                <th>Trạng thái</th>
                {/* "Thao tác" — tên cột thống nhất toàn hệ, KHÔNG dùng "Hành động". */}
                <th className="lg-actcol">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((a) => {
                const [label, cls] = STATUS[a.status] ?? [
                  a.status,
                  "ns-badge--muted",
                ];
                const [kLabel, kCls] = KIND[a.kind] ?? KIND.tam_ung;
                return (
                  <tr key={a.id}>
                    <td>{a.code ?? "—"}</td>
                    <td>
                      <span className={`ns-badge ${kCls}`}>{kLabel}</span>
                    </td>
                    <td>
                      {String(a.period_month).padStart(2, "0")}/{a.period_year}
                    </td>
                    <td>{a.advance_date}</td>
                    <td className="lg-num">{money(a.amount)}đ</td>
                    <td>{a.reason ?? "—"}</td>
                    <td>
                      <span className={`ns-badge ${cls}`}>{label}</span>
                    </td>
                    <td className="lg-rowact">
                      <RowActionButton
                        dense
                        label="In phiếu đề nghị"
                        icon="printer"
                        onClick={() => printAdvanceRequest(advPrintData(a))}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {adding && (
        <MyAdvanceModal
          token={token}
          kind={adding}
          dot1Prefill={data.luong_dot_1}
          kyMinServer={data.ky_min_chon_duoc ?? null}
          onClose={() => setAdding(null)}
          onSaved={() => {
            setAdding(null);
            load();
          }}
        />
      )}
    </div>
  );
}
