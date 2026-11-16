// Hộp LẬP PHIẾU NHẬN (spec 2026-11-13 §4.4): mỗi dòng đơn một khối gồm số đạt, số hỏng, nơi về (xưởng,
// kho hoặc khách), bước nhận khi bước sau có nhiều nhánh, ngày khách nhận khi giao thẳng. Một phần: đạt +
// hỏng không vượt số còn ở nhà gia công (máy chủ chặn, form báo trước). Trọn gói: vượt số đặt chỉ cảnh
// báo. Bài ghép: bảng chia số tờ ghép về từng lệnh hiện trước khi lưu.
import { useEffect, useState } from "react";
import { ApiError } from "../../api/client";
import {
  tgcApi, type TgcNoiVe, type TgcPhieuNhan, type TgcPhieuNhanMoi, type TgcPnMoiDong,
} from "../../api/thueGiaCong";
import { useAuth } from "../../auth/useAuth";
import { ChonNgay } from "../../components/ChonNgay";
import { DetailModal } from "../../components/DetailModal";
import { OGoDinhDang } from "../../components/OGoDinhDang";
import { nhanChang } from "../lsxBuoc";
import { docSoVi, so, tien, vietSoGo } from "./tgc";
import "./thue-gia-cong.css";

export const NHAN_NOI_VE: Record<TgcNoiVe, string> = { xuong: "Về xưởng", kho: "Về kho", khach: "Giao thẳng cho khách" };

type DongForm = { dat: string; hong: string; noiVe: TgcNoiVe | ""; dich: number | null; ngayKhach: string };

function homNay(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dongMacDinh(d: TgcPnMoiDong): DongForm {
  const coTheXacNhan = d.buoc_sau.filter((b) => b.xac_nhan_duoc);
  return {
    dat: "",
    hong: "",
    noiVe: d.noi_ve_hop_le.length === 1 ? d.noi_ve_hop_le[0] : "",
    dich: d.buoc_sau.length === 1 ? d.buoc_sau[0].cong_viec_id : coTheXacNhan.length === 1 ? coTheXacNhan[0].cong_viec_id : null,
    ngayKhach: homNay(),
  };
}

/** Lỗi chặn lưu của một dòng (đúng luật máy chủ), hoặc null. */
function loiDong(d: TgcPnMoiDong, f: DongForm, dat: number, hong: number): string | null {
  if (dat + hong <= 0) return null;
  if (d.ly_do_khong_nhan) return d.ly_do_khong_nhan;
  if (!f.noiVe) return `Chọn nơi về cho “${d.ten_viec}”.`;
  if (f.noiVe === "xuong" && d.buoc_sau.length > 1 && f.dich == null) return `Chọn bước nhận hàng cho “${d.ten_viec}”.`;
  if (d.con_ngoai != null && dat + hong > d.con_ngoai + 1e-9) {
    return `“${d.ten_viec}” chỉ còn ${so(d.con_ngoai)} ${nhanChang(d.don_vi)} ở nhà gia công.`;
  }
  return null;
}

export function PhieuNhanForm({
  donId,
  chiDongDon,
  onClose,
  onDone,
}: {
  donId: number;
  /** Mở từ Việc của tổ: chỉ hiện dòng đơn này. */
  chiDongDon?: number;
  onClose: () => void;
  onDone: (p: TgcPhieuNhan) => void;
}) {
  const { token } = useAuth();
  const [moi, setMoi] = useState<TgcPhieuNhanMoi | null>(null);
  const [form, setForm] = useState<Record<number, DongForm>>({});
  const [ghiChu, setGhiChu] = useState("");
  const [loiNap, setLoiNap] = useState<string | null>(null);
  const [loi, setLoi] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) return;
    tgcApi.moiPhieuNhan(token, donId)
      .then((m) => {
        const ds = chiDongDon ? m.dong.filter((d) => d.don_dong_id === chiDongDon) : m.dong;
        setMoi({ ...m, dong: ds });
        setForm(Object.fromEntries(ds.map((d) => [d.don_dong_id, dongMacDinh(d)])));
      })
      .catch((e) => setLoiNap(e instanceof ApiError ? e.message : String(e)));
  }, [token, donId, chiDongDon]);

  const sua = (id: number, p: Partial<DongForm>) => setForm((f) => ({ ...f, [id]: { ...f[id], ...p } }));

  const tinh = moi ? moi.dong.map((d) => {
    const f = form[d.don_dong_id];
    const dat = docSoVi(f?.dat ?? "") ?? 0;
    const hong = docSoVi(f?.hong ?? "") ?? 0;
    return { d, f, dat, hong, loi: f ? loiDong(d, f, dat, hong) : null };
  }) : [];
  const coDong = tinh.filter((x) => x.dat + x.hong > 0);
  // Mọi dòng đều không nhận được thì lý do đã ghi ngay ở dòng — chân hộp im, đừng bảo gõ số vào ô
  // không có (16/11/2026). Nút Lưu vẫn khoá.
  const khongDongNao = !!moi && moi.dong.length > 0 && moi.dong.every((d) => d.ly_do_khong_nhan);
  const loiChan = moi?.chan_tu_nhan ?? tinh.find((x) => x.loi)?.loi
    ?? (moi && coDong.length === 0 ? (khongDongNao ? "" : "Gõ số đạt hoặc số hỏng của ít nhất một dòng.") : null);

  async function luu() {
    if (!token || !moi || loiChan != null) return;
    setBusy(true);
    setLoi(null);
    try {
      onDone(await tgcApi.lapPhieuNhan(token, moi.don_id, {
        version: moi.version, ghi_chu: ghiChu.trim() || null,
        dong: coDong.map(({ d, f, dat, hong }) => ({
          don_dong_id: d.don_dong_id, sl_dat: dat, sl_hong: hong, noi_ve: f.noiVe as TgcNoiVe,
          dich_cong_viec_id: f.noiVe === "xuong" ? f.dich : null,
          ngay_khach_nhan: f.noiVe === "khach" ? f.ngayKhach || null : null,
        })),
      }));
    } catch (e) {
      setLoi(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <DetailModal
      kicker="Thuê gia công"
      title={moi ? `Nhận hàng từ ${moi.nha_cung_cap_ten}` : "Lập phiếu nhận"}
      width={900}
      onClose={onClose}
      footer={
        <>
          {loi && <span className="tgc-f__loi" role="alert">{loi}</span>}
          {/* Chặn tự nhận đã nói ở đầu hộp — chân hộp không nhắc lại. */}
          {!loi && loiChan && !moi?.chan_tu_nhan && <span className="tgc-f__goi-y">{loiChan}</span>}
          <span className="kcsb-gian" />
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>Đóng</button>
          <button type="button" className="btn btn--primary" disabled={!moi || loiChan != null || busy} onClick={luu}>
            {busy ? "Đang lưu…" : "Lưu phiếu nhận"}
          </button>
        </>
      }
    >
      {loiNap ? <p className="lds-do" role="alert">{loiNap}</p> : moi == null ? <p className="tgc-trong">Đang tải…</p> : (
        <div className="tgc-f">
          {moi.chan_tu_nhan
            ? <p className="tgc-f__canh" role="alert">{moi.chan_tu_nhan}</p>
            : <p className="tgc-f__dan">Đơn {moi.ma_don}. Hàng về xưởng thành bàn giao sang bước sau; về kho thành đề nghị nhập thành phẩm.</p>}
          {moi.dong.length === 0 && <p className="tgc-trong">Không còn dòng nào chờ nhận.</p>}
          {tinh.map(({ d, f, dat, hong }) => {
            if (!f) return null;
            const dv = nhanChang(d.don_vi);
            const vuotDat = d.con_ngoai == null && d.da_dat + d.da_hong + dat + hong > d.sl_dat + 1e-9;
            return (
              <section key={d.don_dong_id} className="tgc-pg-khoi" aria-label={`Nhận ${d.ten_viec}`}>
                <header className="tgc-pg-khoi__dau">
                  <span>{d.ten_viec}</span>
                  {d.lenh.map((l) => <span key={l.lsx_id} className="tgc-u">{l.lsx_ma}</span>)}
                  <span className="kcsb-gian" />
                  <span className="tgc-u">Đặt {so(d.sl_dat)} {dv}</span>
                  {d.da_dat + d.da_hong > 0 && <span className="tgc-u">Đã nhận {so(d.da_dat + d.da_hong)} {dv}</span>}
                  {d.con_ngoai != null && <span className="tgc-u">Còn ở ngoài {so(d.con_ngoai)} {dv}</span>}
                </header>
                {d.ly_do_khong_nhan ? <p className="tgc-f__canh">{d.ly_do_khong_nhan}</p> : (
                  <>
                    <div className="tgc-pn-so">
                      <label className="tgc-f__o">
                        <span className="tgc-f__nhan">Số đạt</span>
                        <span className="tgc-f__khung">
                          <OGoDinhDang inputMode="decimal" value={f.dat} placeholder="0" aria-label={`Số đạt ${d.ten_viec}`}
                            onChange={(e) => sua(d.don_dong_id, { dat: vietSoGo(e.target.value) })} />
                          <span className="tgc-f__hau">{dv}</span>
                        </span>
                      </label>
                      <label className="tgc-f__o">
                        <span className="tgc-f__nhan">Số hỏng</span>
                        <span className="tgc-f__khung">
                          <OGoDinhDang inputMode="decimal" value={f.hong} placeholder="0" aria-label={`Số hỏng ${d.ten_viec}`}
                            onChange={(e) => sua(d.don_dong_id, { hong: vietSoGo(e.target.value) })} />
                          <span className="tgc-f__hau">{dv}</span>
                        </span>
                      </label>
                      <div className="tgc-f__o">
                        <span className="tgc-f__nhan">Tạm tính</span>
                        <span className="tgc-pn-tien">{tien(dat * d.don_gia)}<span className="tgc-u">{so(d.don_gia)} đ/{dv}</span></span>
                      </div>
                    </div>

                    <div className="tgc-pg-muc">
                      <span className="tgc-f__nhan">Nơi về</span>
                      {d.noi_ve_hop_le.length === 1 ? <span>{NHAN_NOI_VE[d.noi_ve_hop_le[0]]}</span> : (
                        <div className="tgc-pg-kho" role="radiogroup" aria-label={`Nơi về ${d.ten_viec}`}>
                          {d.noi_ve_hop_le.map((n) => (
                            <label key={n} className={`tgc-pg-kho__o${f.noiVe === n ? " is-chon" : ""}`}>
                              <input type="radio" name={`noi-${d.don_dong_id}`} checked={f.noiVe === n}
                                onChange={() => sua(d.don_dong_id, { noiVe: n })} />
                              <span>{NHAN_NOI_VE[n]}</span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>

                    {f.noiVe === "xuong" && d.buoc_sau.length > 0 && (
                      <div className="tgc-pg-muc">
                        <span className="tgc-f__nhan">Bước nhận</span>
                        {d.buoc_sau.length === 1 ? <span>{d.buoc_sau[0].ten}</span> : (
                          <div className="tgc-pg-kho" role="radiogroup" aria-label={`Bước nhận ${d.ten_viec}`}>
                            {d.buoc_sau.map((b) => (
                              <label key={b.cong_viec_id} className={`tgc-pg-kho__o${f.dich === b.cong_viec_id ? " is-chon" : ""}`}>
                                <input type="radio" name={`dich-${d.don_dong_id}`} checked={f.dich === b.cong_viec_id}
                                  onChange={() => sua(d.don_dong_id, { dich: b.cong_viec_id })} />
                                <span>{b.ten}</span>
                              </label>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {f.noiVe === "khach" && (
                      <div className="tgc-pg-muc">
                        <span className="tgc-f__nhan">Ngày khách nhận</span>
                        <ChonNgay value={f.ngayKhach} max={homNay()} required aria-label={`Ngày khách nhận ${d.ten_viec}`}
                          onChange={(v) => sua(d.don_dong_id, { ngayKhach: v })} />
                      </div>
                    )}

                    {d.chia_theo_lenh.length > 0 && (
                      <table className="tgc-bang tgc-pg-vt">
                        <thead>
                          <tr><th>Chia về lệnh</th><th className="n">Số con mỗi tờ</th><th>Bước nhận</th><th className="n">Nhận</th></tr>
                        </thead>
                        <tbody>
                          {d.chia_theo_lenh.map((c) => (
                            <tr key={c.lsx_id}>
                              <td>{c.lsx_ma}</td>
                              <td className="n">{so(c.so_con)}</td>
                              <td>{c.buoc_nhan ?? "Kho thành phẩm"}</td>
                              <td className="n">{so(Math.round(dat * c.he_so_nhan * 1000) / 1000)}<span className="tgc-u">{nhanChang(c.don_vi)}</span></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}

                    {vuotDat && (
                      <p className="tgc-f__canh">
                        Tổng nhận {so(d.da_dat + d.da_hong + dat + hong)} {dv} vượt số đặt {so(d.sl_dat)} {dv}. Vẫn lưu được, kiểm lại với nhà gia công.
                      </p>
                    )}
                  </>
                )}
              </section>
            );
          })}
          <label className="tgc-f__o">
            <span className="tgc-f__nhan">Ghi chú</span>
            <textarea rows={2} value={ghiChu} onChange={(e) => setGhiChu(e.target.value)} placeholder="Số phiếu giao hàng của nhà gia công, người giao…" />
          </label>
        </div>
      )}
    </DetailModal>
  );
}
