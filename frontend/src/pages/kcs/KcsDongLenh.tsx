// ĐÓNG LỆNH ở màn KCS (spec 2026-09-29-dong-lenh-thu-cong-design.md). KCS kiểm xong, gửi nhập kho,
// rồi tự bấm đóng — KHÔNG có cổng điều kiện; phần còn dở chỉ hiện thành cảnh báo trong hộp xác nhận.
// Đóng theo NHÓM: mọi lệnh của nhóm đóng cùng lúc. Mở lại được.
// Quyền (08/10/2026): đóng khi đã đủ thì mọi người có ô Thao tác KCS; còn cảnh báo, hoặc mở lại, thì
// phải có ô "Đóng lệnh thiếu" (`duoc_dong_thieu`). Thiếu ô: nút vẫn hiện nhưng khoá kèm lý do.
//
// Phương án B nâng cấp (09/10/2026): nằm trên dải đầu sơ đồ nhóm — số đạt / cần của cả nhóm, nút
// "Đóng lệnh nhóm", hộp xác nhận bật ngay dưới nút.
import { useCallback, useEffect, useState } from "react";
import { ApiError, api, type SxDongLenhTinhTrang } from "../../api/client";
import { useAuth } from "../../auth/useAuth";
import { Icon } from "../../components/Icons";
import { num } from "../keHoachSxShared";
import { nhanDonVi } from "../lsxBuoc";
import { useNapTenDonVi } from "../tenDonVi";

function gioVN(iso: string): string {
  const d = new Date(iso);
  const hai = (n: number) => String(n).padStart(2, "0");
  return `${hai(d.getHours())}:${hai(d.getMinutes())} ${hai(d.getDate())}/${hai(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export function tieuDeDong(tt: SxDongLenhTinhTrang): string {
  const ma = tt.lenh.map((l) => l.ma);
  return ma.length > 1 ? `Đóng ${ma.length} lệnh: ${ma.join(", ")}?` : `Đóng lệnh ${ma[0] ?? ""}?`;
}

export function KcsDongLenh({
  nhomId, canDong, eventTick, onDone,
}: {
  nhomId: number;
  /** Ô Thao tác của dòng KCS — máy chủ gác `gate_kcs`. */
  canDong: boolean;
  eventTick?: number;
  onDone: () => void;
}) {
  const { token } = useAuth();
  const [tt, setTt] = useState<SxDongLenhTinhTrang | null>(null);
  const [loi, setLoi] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hop, setHop] = useState(false);
  useNapTenDonVi();

  const tai = useCallback(() => {
    if (!token) return;
    api.sanXuat.tinhTrangDongLenh(token, nhomId)
      .then((r) => { setTt(r); setLoi(null); })
      .catch((e) => setLoi(e instanceof ApiError ? e.message : "Không đọc được tình trạng lệnh."));
  }, [token, nhomId]);

  useEffect(() => { tai(); }, [tai, eventTick]);

  if (tt == null) return loi ? <span className="lds-do kcsb-dong__loi">{loi}</span> : null;

  const daDong = tt.trang_thai === "closed";

  async function xacNhan() {
    if (!token || !tt || busy) return;
    setBusy(true);
    setLoi(null);
    try {
      const body = { expected_version: tt.version };
      if (daDong) await api.sanXuat.moLaiLenh(token, tt.nhom_id, body);
      else await api.sanXuat.dongLenh(token, tt.nhom_id, body);
      setHop(false);
      tai();
      onDone();
    } catch (e) {
      setLoi(e instanceof ApiError ? e.message : daDong ? "Không mở lại được." : "Không đóng được.");
    } finally {
      setBusy(false);
    }
  }

  const dv = tt.don_vi ? ` ${nhanDonVi(tt.don_vi)}` : "";
  const soCanhBao = tt.canh_bao.length;
  const khoa = !tt.duoc_dong_thieu && (daDong || soCanhBao > 0);
  const lyDoKhoa = daDong
    ? "Cần quyền Đóng lệnh thiếu để mở lại."
    : `Còn ${soCanhBao} điểm chưa xong, cần quyền Đóng lệnh thiếu.`;

  return (
    <span className="kcsb-dong">
      <span className="kcsb-dong__so">
        Đã kiểm đạt <span className="lds-la">{num(tt.da_dat)}</span>
        {tt.muc_tieu != null && <> / {num(tt.muc_tieu)}</>}{dv}
      </span>
      {daDong && (
        <span className="lds-mu kcsb-dong__luc">
          Đã đóng{tt.dong_boi ? ` bởi ${tt.dong_boi}` : ""}{tt.dong_luc ? ` lúc ${gioVN(tt.dong_luc)}` : ""}
        </span>
      )}
      {canDong && (
        <>
          {khoa && (
            <span className="kcsb-dong__khoa" title={tt.canh_bao.map((c) => c.cau).join("\n") || undefined}>
              {lyDoKhoa}
            </span>
          )}
          <button type="button" className={`btn btn--sm ${daDong ? "btn--ghost" : "btn--accent"}`}
            onClick={() => setHop((v) => !v)} disabled={busy || khoa} aria-expanded={hop}>
            <Icon name={daDong ? "rotateCcw" : "packageCheck"} size={13} /> {daDong ? "Mở lại nhóm" : "Đóng lệnh nhóm"}
          </button>
          {hop && (
            <div className="kcsb-dong__hop" role="dialog" aria-label={daDong ? "Mở lại nhóm" : "Đóng lệnh nhóm"}>
              <p>{daDong ? "Mở lại nhóm? Việc chưa làm sẽ hiện lại ở Việc của tổ." : tieuDeDong(tt)}</p>
              {!daDong && soCanhBao > 0 && (
                <ul>{tt.canh_bao.map((c) => <li key={c.ma}>{c.cau}</li>)}</ul>
              )}
              {loi && <p className="lds-do">{loi}</p>}
              <div className="kcsb-dong__nut">
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => setHop(false)} disabled={busy}>
                  Để sau
                </button>
                <button type="button" className="btn btn--accent btn--sm" onClick={xacNhan} disabled={busy}>
                  {busy ? "Đang lưu…" : daDong ? "Xác nhận mở lại" : "Xác nhận đóng"}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </span>
  );
}
