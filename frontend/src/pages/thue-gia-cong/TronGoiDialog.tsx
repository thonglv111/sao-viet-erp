// Thuê gia công TRỌN GÓI cả lệnh (spec 2026-11-13 §3, §5.2) — nút thay cho Phát hành trên lệnh chưa
// phát hành. Màn lệnh CHỈ gắn cờ (13/11/2026): không hỏi số lượng, nhà gia công hay giấy. Số đặt sửa ở
// đơn gia công; giấy xưởng cấp chọn ở Phiếu giao.
import { useState } from "react";
import { PackageCheck } from "lucide-react";
import { ApiError, type LsxDetail } from "../../api/client";
import { tgcApi } from "../../api/thueGiaCong";
import { useAuth } from "../../auth/useAuth";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import "./thue-gia-cong.css";

export function TronGoiDialog({
  lsx,
  open,
  onClose,
  onDone,
}: {
  lsx: LsxDetail;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const { token } = useAuth();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function dat() {
    if (!token) return;
    setBusy(true);
    setErr(null);
    try {
      await tgcApi.datTronGoi(token, lsx.id, {});
      onDone();
    } catch (e: unknown) {
      setErr(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ConfirmDialog
      open={open}
      icon={<PackageCheck size={20} />}
      title={`Thuê gia công trọn gói ${lsx.ma}?`}
      message="Lệnh không xuống tổ, không vào Xếp lịch. Việc “Gia công trọn gói” vào Hàng chờ của màn Thuê gia công; chọn nhà gia công, số đặt và giấy ở đó."
      confirmLabel="Thuê gia công trọn gói"
      busy={busy}
      error={err}
      onConfirm={dat}
      onCancel={onClose}
    />
  );
}
