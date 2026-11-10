// Hộp "Giao đơn cho người phụ trách" (08/11/2026, docs/design-giao-don-lam-lenh.md).
//
// Người có ô Giao đơn tick đơn ở Hàng chờ tiếp nhận → bấm Giao → chọn MỘT người (gõ tìm được) trong
// danh sách máy chủ trả: cùng phòng (kể cả phòng con), có Thao tác ở Lệnh sản xuất, kể cả bản thân.
// Đơn đang giao cho người khác thì hỏi xác nhận một bước nữa trước khi chuyển.
import { useEffect, useMemo, useState } from "react";
import { ApiError, api, type GiaoDonOut, type HangChoItem, type NguoiLamLenh } from "../api/client";
import { useAuth } from "../auth/useAuth";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { khopGanDung } from "../utils/timGanDung";

export function HopGiaoDon({
  don,
  onDong,
  onXong,
}: {
  /** Các đơn đã tick (đủ để biết đơn nào đang giao cho ai). */
  don: HangChoItem[];
  onDong: () => void;
  onXong: (kq: GiaoDonOut) => void;
}) {
  const { token, user } = useAuth();
  const [ds, setDs] = useState<NguoiLamLenh[] | null>(null);
  const [tim, setTim] = useState("");
  const [chon, setChon] = useState<number | null>(null);
  const [buoc, setBuoc] = useState<"chon" | "xac_nhan">("chon");
  const [ban, setBan] = useState(false);
  const [loi, setLoi] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    api.lsx
      .nguoiLamLenh(token)
      .then(setDs)
      .catch((e: unknown) => setLoi(e instanceof ApiError ? e.message : String(e)));
  }, [token]);

  const loc = useMemo(() => {
    if (!ds) return [];
    return ds.filter((n) => khopGanDung(`${n.ten} ${n.phong ?? ""}`, tim));
  }, [ds, tim]);

  const nguoiMoi = ds?.find((n) => n.id === chon) ?? null;
  // Đơn đang giao cho NGƯỜI KHÁC người vừa chọn — gom theo người đang giữ để câu hỏi nói rõ.
  const chuyen = useMemo(() => {
    const theoNguoi = new Map<string, number>();
    for (const o of don) {
      if (o.nguoi_lam_lenh_id && o.nguoi_lam_lenh_id !== chon) {
        const ten = o.nguoi_lam_lenh_ten ?? "người khác";
        theoNguoi.set(ten, (theoNguoi.get(ten) ?? 0) + 1);
      }
    }
    return [...theoNguoi.entries()];
  }, [don, chon]);

  async function giao() {
    if (!token || chon == null) return;
    if (buoc === "chon" && chuyen.length > 0) {
      setBuoc("xac_nhan");
      return;
    }
    setBan(true);
    setLoi(null);
    try {
      onXong(await api.lsx.giaoDon(token, don.map((o) => o.order_id), chon));
    } catch (e: unknown) {
      setLoi(e instanceof ApiError ? e.message : String(e));
      setBuoc("chon");
    } finally {
      setBan(false);
    }
  }

  return (
    <ConfirmDialog
      open
      title={buoc === "chon" ? `Giao ${don.length} đơn cho người phụ trách` : "Chuyển đơn sang người khác?"}
      confirmLabel={buoc === "chon" ? "Giao" : "Chuyển"}
      cancelLabel={buoc === "chon" ? "Thôi" : "Quay lại"}
      busy={ban}
      error={loi}
      confirmDisabled={chon == null}
      closeOnBackdrop={false}
      onConfirm={() => void giao()}
      onCancel={() => (buoc === "xac_nhan" ? setBuoc("chon") : onDong())}
    >
      {buoc === "xac_nhan" && nguoiMoi ? (
        <ul className="khsx-giao__chuyen">
          {chuyen.map(([ten, n]) => (
            <li key={ten}>
              {n} đơn đang giao cho {ten} sẽ chuyển sang {nguoiMoi.ten}.
            </li>
          ))}
          <li className="khsx-giao__mu">Lệnh đã tạo của các đơn này vẫn giữ người phụ trách cũ.</li>
        </ul>
      ) : (
        <div className="khsx-giao">
          <input
            type="search"
            className="khsx-giao__tim"
            placeholder="Gõ tên người hoặc phòng"
            aria-label="Tìm người phụ trách"
            value={tim}
            onChange={(e) => setTim(e.target.value)}
            autoFocus
          />
          <div className="khsx-giao__ds" role="radiogroup" aria-label="Người phụ trách">
            {ds === null && !loi ? (
              <p className="khsx-giao__mu">Đang tải…</p>
            ) : loc.length === 0 ? (
              <p className="khsx-giao__mu">
                {ds && ds.length === 0
                  ? "Phòng của bạn chưa có ai có quyền Thao tác ở Lệnh sản xuất."
                  : "Không có ai khớp chữ đang gõ."}
              </p>
            ) : (
              loc.map((n) => (
                <label key={n.id} className={`khsx-giao__nguoi${chon === n.id ? " is-chon" : ""}`}>
                  <input
                    type="radio"
                    name="nguoi-lam-lenh"
                    checked={chon === n.id}
                    onChange={() => setChon(n.id)}
                  />
                  <span>{n.id === user?.id ? `${n.ten} (bạn)` : n.ten}</span>
                  {n.phong ? <span className="khsx-giao__phong">{n.phong}</span> : null}
                </label>
              ))
            )}
          </div>
        </div>
      )}
    </ConfirmDialog>
  );
}
