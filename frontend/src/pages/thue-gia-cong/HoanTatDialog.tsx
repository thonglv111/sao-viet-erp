// Hộp HOÀN TẤT một dòng đơn gia công (spec 2026-11-13 §4.5): không chờ thêm hàng nữa. Hỏi vật tư kho
// nhà gia công trả về bao nhiêu (mặc định 0 = dùng hết); số trả thành một đề nghị nhập kho. Hao hụt
// máy chủ chụp lúc lưu. Công việc của bước chuyển Hoàn thành chỉ ở đây.
import { useState } from "react";
import { ApiError } from "../../api/client";
import { tgcApi, type TgcDon, type TgcDonDong } from "../../api/thueGiaCong";
import { useAuth } from "../../auth/useAuth";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { OGoDinhDang } from "../../components/OGoDinhDang";
import { nhanKho } from "../../lib/khoGiay";
import { nhanChang, nhanDonVi } from "../lsxBuoc";
import { docSoVi, so, vietSoGo } from "./tgc";

export function HoanTatDialog({
  don,
  dong,
  onClose,
  onDone,
}: {
  don: TgcDon;
  dong: TgcDonDong;
  onClose: () => void;
  onDone: () => void;
}) {
  const { token } = useAuth();
  const vt = (dong.vat_tu_ngoai ?? []).filter((m) => m.xuat > 0);
  const [tra, setTra] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [loi, setLoi] = useState<string | null>(null);

  const dv = nhanChang(dong.don_vi);
  const haoHut = dong.kieu === "tron_goi" ? null : Math.max(dong.giao_quy_doi - dong.dat - dong.hong, 0);
  const vuot = vt.find((m, i) => (docSoVi(tra[i] ?? "") ?? 0) > m.con_ngoai + 1e-9);

  async function luu() {
    if (!token || vuot) return;
    setBusy(true);
    setLoi(null);
    try {
      await tgcApi.hoanTat(token, dong.id, {
        version: don.version,
        tra_ve: vt.map((m, i) => ({
          hang_loai: m.hang_loai, hang_id: m.hang_id, kho_rong: m.kho_rong, kho_dai: m.kho_dai,
          so_luong: docSoVi(tra[i] ?? "") ?? 0,
        })).filter((x) => x.so_luong > 0),
      });
      onDone();
    } catch (e) {
      setLoi(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ConfirmDialog
      open
      title={`Hoàn tất ${dong.ten_viec}?`}
      confirmLabel="Hoàn tất"
      busy={busy}
      error={loi ?? (vuot ? `“${vuot.ten}” trả về không vượt số còn ở nhà gia công.` : null)}
      confirmDisabled={!!vuot}
      onConfirm={luu}
      onCancel={onClose}
    >
      <div className="tgc-f">
        <p className="tgc-f__dan">
          {`Đã nhận đạt ${so(dong.dat)} ${dv}`}
          {dong.hong > 0 && `, hỏng ${so(dong.hong)}`}
          {haoHut != null && `. Hao hụt ghi nhận ${so(haoHut)} ${dv}`}
          . Hoàn tất rồi thì không nhận thêm hàng cho dòng này, bước chuyển Hoàn thành.
        </p>
        {vt.length > 0 && (
          <table className="tgc-bang">
            <thead>
              <tr><th>Vật tư kho đã xuất</th><th className="n">Kho xuất</th><th className="n">Còn ở ngoài</th><th className="n">Trả về kho</th></tr>
            </thead>
            <tbody>
              {vt.map((m, i) => (
                <tr key={`${m.hang_loai}-${m.hang_id}-${m.kho_rong}-${m.kho_dai}`}>
                  <td>{m.ten}{m.kho_rong > 0 && <span className="tgc-u">Khổ {nhanKho(m.kho_rong, m.kho_dai)}</span>}</td>
                  <td className="n">{so(m.xuat)}<span className="tgc-u">{nhanDonVi(m.don_vi)}</span></td>
                  <td className="n">{so(m.con_ngoai)}</td>
                  <td className="n">
                    <span className="tgc-f__khung">
                      <OGoDinhDang inputMode="decimal" value={tra[i] ?? ""} placeholder="0" aria-label={`Trả về ${m.ten}`}
                        onChange={(e) => setTra((t) => ({ ...t, [i]: vietSoGo(e.target.value) }))} />
                      <span className="tgc-f__hau">{nhanDonVi(m.don_vi)}</span>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {vt.length > 0 && <p className="tgc-f__goi-y">Để trống là nhà gia công dùng hết. Số trả về thành đề nghị nhập kho.</p>}
      </div>
    </ConfirmDialog>
  );
}
