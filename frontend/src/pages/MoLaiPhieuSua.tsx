// Nút "Mở lại" của phiếu sửa chữa đã sửa xong (lỗi #51 bấm thử 18/10/2026). Sửa chưa đạt, máy hỏng
// lại thì mở lại đúng phiếu cũ thay vì lập phiếu mới — giữ liền mạch lịch sử của lần sửa. Máy chủ
// bắt lý do (đảo một lần đóng phiếu), lý do vào Lịch sử thao tác của phiếu.
import { useState } from "react";
import { kyThuatMay, type SuaChua } from "../api/kyThuatMay";
import { useAuth } from "../auth/useAuth";
import { Button } from "../components/Button";
import { ConfirmDialog } from "../components/ConfirmDialog";

export function MoLaiPhieuSua({ phieuId, onDone }: { phieuId: number; onDone: (p: SuaChua) => void }) {
  const { token } = useAuth();
  const [mo, setMo] = useState(false);
  const [lyDo, setLyDo] = useState("");
  const [dang, setDang] = useState(false);
  const [loi, setLoi] = useState<string | null>(null);

  const dong = () => { setMo(false); setLyDo(""); setLoi(null); };
  const xacNhan = async () => {
    if (!token || dang || !lyDo.trim()) return;
    setDang(true);
    setLoi(null);
    try {
      const p = await kyThuatMay.trangThaiSuaChua(token, phieuId, "cho_sua", lyDo.trim());
      dong();
      onDone(p);
    } catch (e) {
      setLoi(e instanceof Error ? e.message : "Không mở lại được phiếu.");
    } finally {
      setDang(false);
    }
  };

  return (
    <>
      <Button variant="ghost" onClick={() => setMo(true)}>Mở lại</Button>
      <ConfirmDialog
        open={mo}
        title="Mở lại phiếu sửa"
        message="Phiếu quay về Chờ sửa, giờ sửa xong cũ bị gỡ. Lý do ghi vào Lịch sử thao tác của phiếu."
        confirmLabel={dang ? "Đang lưu…" : "Mở lại phiếu"}
        cancelLabel="Huỷ"
        busy={dang}
        error={loi}
        confirmDisabled={!lyDo.trim()}
        onConfirm={() => void xacNhan()}
        onCancel={dong}
      >
        <label style={{ display: "block", fontSize: 13, marginBottom: 6 }} htmlFor="ktm-ly-do-mo-lai">Lý do mở lại</label>
        <textarea id="ktm-ly-do-mo-lai" className="ktm-ly-do" autoFocus rows={3} maxLength={500} value={lyDo}
          placeholder="Ví dụ: máy kẹt lại sau 2 giờ chạy" onChange={(e) => setLyDo(e.target.value)}
          style={{ width: "100%", boxSizing: "border-box" }} />
      </ConfirmDialog>
    </>
  );
}
