// Hộp "Khoá máy" của Xếp lịch — khai khoảng máy nghỉ (bảo trì, hỏng, nghỉ riêng máy).
//
// Lỗi #50 bấm thử 18/10/2026: route vùng khoá mất cùng bàn theo công đoạn (20/08/2026) nên không
// còn lối nào khai được, nhãn "Đang bảo trì" ở màn Máy và cảnh báo đè lịch khoá không bao giờ có
// dữ liệu. Khoá máy CHỈ làm thanh lệnh trên máy đó hiện cảnh báo, không chặn xếp lịch (chủ hạ mức
// 21/08/2026, xem `constraint.de_vung_khoa_may` ở máy chủ).
import { useEffect, useState } from "react";
import { Wrench } from "lucide-react";
import { api, type XlMayGon, type XlVungKhoa } from "../api/client";
import { useAuth } from "../auth/useAuth";
import { ChonNgayGio } from "../components/ChonNgay";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { gioVN } from "../utils/ky";

const LY_DO: { id: string; ten: string }[] = [
  { id: "bao_tri", ten: "Bảo trì" },
  { id: "hong_hoc", ten: "Hỏng" },
  { id: "nghi", ten: "Nghỉ" },
  { id: "khac", ten: "Khác" },
];
// Khoảng "chạy thêm ngoài ca" (`mo_them`) không có lý do nghỉ — máy chủ ép `khac`, đọc ra phải là
// chạy thêm chứ không phải "Khác".
const tenLyDo = (k: XlVungKhoa) =>
  k.kieu === "mo_them" ? "Chạy thêm" : LY_DO.find((l) => l.id === k.ly_do)?.ten ?? "Khác";

/** Đầu giờ kế tiếp + `themGio`, theo giờ xưởng (VN) — máy mở trang ở múi khác vẫn ra đúng giờ. */
const dauGioKe = (themGio: number) => gioVN(Date.now(), { themGio, troiGio: true });

const ngayGio = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)} ${s.slice(11, 16)}`;

export function XlKhoaMay({ open, suaDuoc, onDong, onDoi }: {
  open: boolean;
  suaDuoc: boolean;
  onDong(): void;
  /** Vừa thêm / xoá một khoảng — bàn nạp lại để thanh lệnh nhận cảnh báo mới. */
  onDoi(): void;
}) {
  const { token } = useAuth();
  const [may, setMay] = useState<XlMayGon[]>([]);
  const [mayId, setMayId] = useState<number | null>(null);
  const [ds, setDs] = useState<XlVungKhoa[] | null>(null);
  const [tu, setTu] = useState(() => dauGioKe(0));
  const [den, setDen] = useState(() => dauGioKe(4));
  const [lyDo, setLyDo] = useState("bao_tri");
  const [ghiChu, setGhiChu] = useState("");
  const [loi, setLoi] = useState<string | null>(null);
  const [dangGhi, setDangGhi] = useState(false);
  const [canXoa, setCanXoa] = useState<XlVungKhoa | null>(null);

  useEffect(() => {
    if (!open || !token) return;
    let huy = false;
    api.xepLich.mayGon(token)
      .then((r) => { if (!huy) setMay(r); })
      .catch((e) => { if (!huy) setLoi(e?.message ?? "Không tải được danh sách máy."); });
    return () => { huy = true; };
  }, [open, token]);

  useEffect(() => {
    setDs(null);
    if (!open || !token || mayId == null) return;
    let huy = false;
    api.xepLich.vungKhoa(token, mayId)
      .then((r) => { if (!huy) setDs(r); })
      // Lỗi thì thôi "Đang tải…" — bảng rỗng + câu lỗi, không đứng mãi.
      .catch((e) => { if (!huy) { setDs([]); setLoi(e?.message ?? "Không tải được khoảng khoá."); } });
    return () => { huy = true; };
  }, [open, token, mayId]);

  const napLai = async () => {
    if (!token || mayId == null) return;
    setDs(await api.xepLich.vungKhoa(token, mayId));
  };

  const them = async () => {
    if (!token || mayId == null) return;
    if (!tu || !den || tu >= den) { setLoi("Giờ bắt đầu phải trước giờ kết thúc."); return; }
    setDangGhi(true);
    setLoi(null);
    try {
      await api.xepLich.taoVungKhoa(token, mayId, { tu, den, ly_do: lyDo, note: ghiChu.trim() || null });
      setGhiChu("");
      await napLai();
      onDoi();
    } catch (e) {
      setLoi((e as Error)?.message ?? "Không thêm được khoảng khoá.");
    } finally {
      setDangGhi(false);
    }
  };

  const xoa = async (k: XlVungKhoa) => {
    if (!token) return;
    setDangGhi(true);
    setLoi(null);
    try {
      await api.xepLich.xoaVungKhoa(token, k.id);
      setCanXoa(null);
      await napLai();
      onDoi();
    } catch (e) {
      setCanXoa(null);
      setLoi((e as Error)?.message ?? "Không xoá được khoảng khoá.");
    } finally {
      setDangGhi(false);
    }
  };

  return (
    <ConfirmDialog
      open={open}
      title="Khoá máy"
      icon={<Wrench size={20} />}
      message="Khai giờ máy nghỉ để bảo trì, sửa hoặc nghỉ riêng. Lệnh xếp đè lên giờ này sẽ hiện cảnh báo trên thanh, không bị chặn."
      cancelLabel="Đóng"
      hideConfirm
      wide
      error={loi}
      onConfirm={onDong}
      // Esc khi hộp hỏi xoá đang mở chỉ đóng hộp hỏi — cả hai cùng nghe phím trên document.
      onCancel={() => { if (!canXoa) onDong(); }}
    >
      <div className="xa-km">
        <label className="xa-km__o">
          <span>Máy</span>
          <select value={mayId ?? ""} onChange={(e) => setMayId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">Chọn máy</option>
            {may.map((m) => <option key={m.id} value={m.id}>{m.ten}</option>)}
          </select>
        </label>

        {mayId != null && ds === null && <p className="xa-mo">Đang tải…</p>}
        {ds !== null && ds.length === 0 && <p className="xa-mo">Máy này chưa có khoảng khoá nào.</p>}
        {ds !== null && ds.length > 0 && (
          <table className="xa-km__bang">
            <thead><tr><th>Từ</th><th>Đến</th><th>Lý do</th><th>Ghi chú</th>{suaDuoc && <th />}</tr></thead>
            <tbody>
              {ds.map((k) => (
                <tr key={k.id}>
                  <td>{ngayGio(k.start)}</td>
                  <td>{ngayGio(k.finish)}</td>
                  <td>{tenLyDo(k)}</td>
                  <td>{k.note ?? ""}</td>
                  {suaDuoc && (
                    <td>
                      <button type="button" className="xa-btn" disabled={dangGhi}
                        aria-label={`Xoá khoảng khoá ${ngayGio(k.start)}`} onClick={() => setCanXoa(k)}>Xoá</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {suaDuoc && mayId != null && (
          <div className="xa-km__them">
            <label className="xa-km__o"><span>Từ</span>
              <ChonNgayGio value={tu} onChange={setTu} min="2000-01-01T00:00" max="2099-12-31T23:59" aria-label="Từ" xoaDuoc={false} />
            </label>
            <label className="xa-km__o"><span>Đến</span>
              <ChonNgayGio value={den} onChange={setDen} min="2000-01-01T00:00" max="2099-12-31T23:59" aria-label="Đến" xoaDuoc={false} />
            </label>
            <label className="xa-km__o"><span>Lý do</span>
              <select value={lyDo} onChange={(e) => setLyDo(e.target.value)}>
                {LY_DO.map((l) => <option key={l.id} value={l.id}>{l.ten}</option>)}
              </select>
            </label>
            <label className="xa-km__o xa-km__o--rong"><span>Ghi chú</span>
              <input value={ghiChu} maxLength={500} onChange={(e) => setGhiChu(e.target.value)} placeholder="Ví dụ: thay lô cao su" />
            </label>
            <button type="button" className="xa-btn xa-btn--xanh" disabled={dangGhi} onClick={() => void them()}>Thêm khoảng khoá</button>
          </div>
        )}
      </div>
      <ConfirmDialog
        open={canXoa != null}
        title="Xoá khoảng khoá?"
        message={canXoa ? `Bỏ khoảng ${tenLyDo(canXoa).toLowerCase()} từ ${ngayGio(canXoa.start)} đến ${ngayGio(canXoa.finish)}. Lệnh trên máy này sẽ thôi cảnh báo cho giờ đó.` : ""}
        confirmLabel="Xoá"
        danger
        busy={dangGhi}
        onConfirm={() => { if (canXoa) void xoa(canXoa); }}
        onCancel={() => setCanXoa(null)}
      />
    </ConfirmDialog>
  );
}
