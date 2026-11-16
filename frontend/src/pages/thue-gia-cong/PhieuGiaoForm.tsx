// Hộp LẬP PHIẾU GIAO (spec 2026-11-13 §4.3): mỗi dòng đơn một khối gồm bán thành phẩm (lấy theo bàn
// giao tổ bước trước đã đề xuất, không gõ tay; dải đầu lệnh thì gõ số), vật tư xưởng cấp (điền sẵn phần
// định mức còn thiếu, gõ lại được, vượt không chặn) và giấy trọn gói (chọn khổ theo tồn). Vật tư và giấy
// đi qua một đề nghị xuất kho; bán thành phẩm không qua kho.
import { useEffect, useState } from "react";
import { ApiError } from "../../api/client";
import { tgcApi, type TgcPgMoiDong, type TgcPhieuGiao, type TgcPhieuGiaoMoi } from "../../api/thueGiaCong";
import { useAuth } from "../../auth/useAuth";
import { DetailModal } from "../../components/DetailModal";
import { OGoDinhDang } from "../../components/OGoDinhDang";
import { nhanKho } from "../../lib/khoGiay";
import { ngayGioDayDu } from "../loc-san-xuat/ngay";
import { nhanChang, nhanDonVi } from "../lsxBuoc";
import { docSoVi, so, vietSoGo } from "./tgc";
import "./thue-gia-cong.css";

const oSo = (n: number | null | undefined) => (n == null || n <= 0 ? "" : vietSoGo(String(n).replace(".", ",")));

type KhoChon = { kho_rong: number; kho_dai: number };
type DongForm = {
  nhanBg: boolean;
  slGo: string;
  vatTu: Record<number, string>;
  kho: KhoChon | null;
  slGiay: string;
};

function dongMacDinh(d: TgcPgMoiDong): DongForm {
  const g = d.giay;
  const kho = g?.kho.find((k) => k.dung_de_xuat) ?? g?.kho[0] ?? null;
  return {
    nhanBg: (d.ban_thanh_pham?.ban_giao.length ?? 0) > 0,
    slGo: "",
    vatTu: Object.fromEntries(d.vat_tu.map((v) => [v.lsx_cong_doan_vat_tu_id, oSo(v.goi_y)])),
    kho: kho ? { kho_rong: kho.kho_rong, kho_dai: kho.kho_dai } : null,
    slGiay: oSo(g?.de_xuat?.so_to),
  };
}

type KhoGiay = NonNullable<TgcPgMoiDong["giay"]>["kho"][number];

/** Giấy xưởng cấp cho trọn gói: lưới ô khổ kèm tồn kho (chọn một, khổ theo lệnh đứng đầu rồi tồn
 *  nhiều trước, hiện đủ không cuộn), ô xin xuất, nhắc số theo lệnh và phần kho thiếu. Không được xem
 *  tồn thì ô chỉ còn khổ. */
function GiayXuongCap({
  d, f, xemTon, onSua,
}: {
  d: TgcPgMoiDong;
  f: DongForm;
  xemTon: boolean;
  onSua: (p: Partial<DongForm>) => void;
}) {
  const g = d.giay;
  if (!g) return null;
  if (g.ly_do) {
    return (
      <div className="tgc-pg-muc">
        <span className="tgc-f__nhan">Giấy xưởng cấp</span>
        <span className="tgc-f__canh">{g.ly_do}</span>
      </div>
    );
  }
  const laChon = (k: KhoGiay) => f.kho?.kho_rong === k.kho_rong && f.kho?.kho_dai === k.kho_dai;
  const dang = g.kho.find(laChon) ?? null;
  const dvGo = f.kho && f.kho.kho_dai === 0 ? "kg" : "tờ";
  const sl = docSoVi(f.slGiay) ?? 0;
  const theoLenh = dang?.dung_de_xuat && g.de_xuat?.so_to != null ? g.de_xuat.so_to : null;
  const thieu = xemTon && dang?.ton != null && sl > dang.ton ? sl - dang.ton : 0;
  // Đổi sang khổ khác đơn vị (tờ ↔ kg) thì số cũ vô nghĩa: xoá; quay về khổ theo lệnh thì điền lại.
  const chonKho = (k: KhoGiay) => {
    if (laChon(k)) return;
    const doiDv = (k.kho_dai === 0) !== (f.kho?.kho_dai === 0);
    onSua({
      kho: { kho_rong: k.kho_rong, kho_dai: k.kho_dai },
      ...(k.dung_de_xuat ? { slGiay: oSo(g.de_xuat?.so_to) } : doiDv ? { slGiay: "" } : {}),
    });
  };
  return (
    <div className="tgc-pg-muc">
      <div className="tgc-pg-muc__dau">
        <span className="tgc-f__nhan">Giấy xưởng cấp</span>
        <span>{g.giay_ten ?? g.giay_ma}</span>
      </div>
      <div className="tgc-kho-giay" role="radiogroup" aria-label="Chọn khổ giấy xuất">
        {g.kho.map((k) => {
          const chon = laChon(k);
          return (
            <label key={`${k.kho_rong}x${k.kho_dai}`} className={`tgc-kho-giay__o${chon ? " is-chon" : ""}`}>
              <input type="radio" name={`kho-${d.don_dong_id}`} checked={chon} onChange={() => chonKho(k)} />
              <span className="tgc-kho-giay__dau">
                <span>{nhanKho(k.kho_rong, k.kho_dai)}</span>
                {k.dung_de_xuat && <span className="tgc-the">Theo lệnh</span>}
              </span>
              {xemTon && (
                <span className={`tgc-u${k.ton === 0 ? " tgc-canh" : ""}`}>Tồn {so(k.ton ?? 0)} {nhanDonVi(k.don_vi)}</span>
              )}
            </label>
          );
        })}
      </div>
      <div className="tgc-pg-xin">
        <span className="tgc-f__nhan">Xin xuất</span>
        <span className="tgc-f__khung tgc-pg-o">
          <OGoDinhDang inputMode="decimal" value={f.slGiay} placeholder="0" aria-label={`Số giấy xin xuất cho ${d.ten_viec}`}
            onChange={(e) => onSua({ slGiay: vietSoGo(e.target.value) })} />
          <span className="tgc-f__hau">{dvGo}</span>
        </span>
        {theoLenh != null && <span className="tgc-mu">Theo lệnh cần {so(theoLenh)} {dvGo}</span>}
        {thieu > 0 && <span className="tgc-canh">Kho khổ này thiếu {so(thieu)} {dvGo}</span>}
      </div>
    </div>
  );
}

export function PhieuGiaoForm({
  donId,
  onClose,
  onDone,
}: {
  donId: number;
  onClose: () => void;
  onDone: (p: TgcPhieuGiao) => void;
}) {
  const { token } = useAuth();
  const [moi, setMoi] = useState<TgcPhieuGiaoMoi | null>(null);
  const [form, setForm] = useState<Record<number, DongForm>>({});
  const [ghiChu, setGhiChu] = useState("");
  const [loiNap, setLoiNap] = useState<string | null>(null);
  const [loi, setLoi] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) return;
    tgcApi.moiPhieuGiao(token, donId)
      .then((m) => {
        setMoi(m);
        setForm(Object.fromEntries(m.dong.map((d) => [d.don_dong_id, dongMacDinh(d)])));
      })
      .catch((e) => setLoiNap(e instanceof ApiError ? e.message : String(e)));
  }, [token, donId]);

  const sua = (id: number, p: Partial<DongForm>) => setForm((f) => ({ ...f, [id]: { ...f[id], ...p } }));

  const body = moi ? moi.dong.map((d) => {
    const f = form[d.don_dong_id];
    const btp = d.ban_thanh_pham;
    const slGo = docSoVi(f?.slGo ?? "");
    const giaoBtp = !!btp && ((btp.ban_giao.length > 0 && !!f?.nhanBg) || (btp.go_tay && (slGo ?? 0) > 0));
    const slGiay = docSoVi(f?.slGiay ?? "");
    return {
      don_dong_id: d.don_dong_id,
      giao_ban_thanh_pham: giaoBtp,
      sl_go: btp?.go_tay && giaoBtp ? slGo : null,
      vat_tu: d.vat_tu
        .map((v) => ({ lsx_cong_doan_vat_tu_id: v.lsx_cong_doan_vat_tu_id, so_luong: docSoVi(f?.vatTu[v.lsx_cong_doan_vat_tu_id] ?? "") ?? 0 }))
        .filter((v) => v.so_luong > 0),
      giay: d.giay?.giay_id && f?.kho && (slGiay ?? 0) > 0 ? { ...f.kho, so_luong: slGiay ?? 0 } : null,
    };
  }).filter((x) => x.giao_ban_thanh_pham || x.vat_tu.length > 0 || x.giay) : [];
  // Chân hộp chỉ bảo tick/gõ khi thật có ô để tick/gõ (16/11/2026). Không ô nào vì bán thành phẩm còn
  // chờ tổ bước trước bàn giao thì khối hàng đã nói — chân hộp im, nút Lưu vẫn khoá.
  const coO = !!moi && moi.dong.some((d) =>
    (d.ban_thanh_pham && (d.ban_thanh_pham.ban_giao.length > 0 || d.ban_thanh_pham.go_tay)) || d.vat_tu.length > 0 || !!d.giay);
  const choBanGiao = !!moi && moi.dong.some((d) =>
    d.ban_thanh_pham && d.ban_thanh_pham.ban_giao.length === 0 && !d.ban_thanh_pham.go_tay);
  const thieu = moi && body.length === 0
    ? (coO ? "Chưa có gì để giao. Tick bán thành phẩm, gõ số vật tư hoặc số giấy xin xuất."
      : choBanGiao ? "" : "Đơn này không có gì phải giao.")
    : null;

  async function luu() {
    if (!token || !moi || thieu != null) return;
    setBusy(true);
    setLoi(null);
    try {
      onDone(await tgcApi.lapPhieuGiao(token, moi.don_id, { version: moi.version, ghi_chu: ghiChu.trim() || null, dong: body }));
    } catch (e) {
      setLoi(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <DetailModal
      kicker={moi ? `Đơn ${moi.ma_don}` : undefined}
      title={moi ? `Giao hàng cho ${moi.nha_cung_cap_ten}` : "Lập phiếu giao"}
      width={900}
      onClose={onClose}
      footer={
        <>
          {loi && <span className="tgc-f__loi" role="alert">{loi}</span>}
          {!loi && thieu && <span className="tgc-f__goi-y">{thieu}</span>}
          <span className="kcsb-gian" />
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>Đóng</button>
          <button type="button" className="btn btn--primary" disabled={!moi || thieu != null || busy} onClick={luu}>
            {busy ? "Đang lưu…" : "Lưu phiếu giao"}
          </button>
        </>
      }
    >
      {loiNap ? <p className="lds-do" role="alert">{loiNap}</p> : moi == null ? <p className="tgc-trong">Đang tải…</p> : (
        <div className="tgc-f">
          <p className="tgc-f__dan">Vật tư và giấy lập đề nghị xuất kho. Bán thành phẩm đưa thẳng, không qua kho.</p>
          {moi.dong.length === 0 && <p className="tgc-trong">Mọi dòng của đơn đã hoàn tất.</p>}
          {moi.dong.map((d) => {
            const f = form[d.don_dong_id];
            if (!f) return null;
            const btp = d.ban_thanh_pham;
            const dvDat = nhanChang(d.don_vi);
            return (
              <section key={d.don_dong_id} className="tgc-pg-khoi" aria-label={`Giao ${d.ten_viec}`}>
                <header className="tgc-pg-khoi__dau">
                  <span>{d.ten_viec}</span>
                  <span className="tgc-u">{d.lenh.map((l) => l.lsx_ma).join(", ")}</span>
                  <span className="kcsb-gian" />
                  <span className="tgc-u">Đặt {so(d.sl_dat)} {dvDat}</span>
                  {d.da_giao > 0 && <span className="tgc-u">Đã giao {so(d.da_giao)}</span>}
                </header>

                {btp && (
                  <div className="tgc-pg-muc">
                    <span className="tgc-f__nhan">Bán thành phẩm</span>
                    {btp.ban_giao.length > 0 ? (
                      <label className="tgc-pg-tick">
                        <input type="checkbox" checked={f.nhanBg} onChange={(e) => sua(d.don_dong_id, { nhanBg: e.target.checked })}
                          aria-label={`Nhận bàn giao cho ${d.ten_viec}`} />
                        <span>
                          {so(btp.ban_giao.reduce((s, b) => s + b.so_luong, 0))} {nhanChang(btp.ban_giao[0].don_vi)}
                          <span className="tgc-u">
                            {btp.ban_giao.map((b) => `${so(b.so_luong)} từ ${b.nguon_ten || "bước trước"}${b.luc ? ` lúc ${ngayGioDayDu(b.luc)}` : ""}`).join("; ")}
                          </span>
                        </span>
                      </label>
                    ) : btp.go_tay ? (
                      <span className="tgc-f__khung tgc-pg-o">
                        <OGoDinhDang inputMode="decimal" value={f.slGo} placeholder="0" aria-label={`Số bán thành phẩm giao ${d.ten_viec}`}
                          onChange={(e) => sua(d.don_dong_id, { slGo: vietSoGo(e.target.value) })} />
                        <span className="tgc-f__hau">{nhanChang(btp.don_vi)}</span>
                      </span>
                    ) : d.da_giao > 0 ? (
                      // Đã giao rồi mà không còn bàn giao chờ: đừng nói như chưa giao gì (16/11/2026).
                      <span className="tgc-u">Đã giao hết số tổ bước trước bàn giao. Tổ bàn giao thêm thì giao tiếp được.</span>
                    ) : (
                      <span className="tgc-u">Bước trước chưa bàn giao hàng sang. Chờ tổ bàn giao rồi mới giao được.</span>
                    )}
                  </div>
                )}

                {d.vat_tu.length > 0 && (
                  <div className="tgc-pg-muc">
                    <span className="tgc-f__nhan">Vật tư xưởng cấp</span>
                    <table className="tgc-bang tgc-pg-vt">
                      <thead>
                        <tr>
                          <th>Vật tư</th>
                          <th className="n">Định mức</th>
                          <th className="n">Đã giao</th>
                          {moi.xem_ton && <th className="n">Tồn kho</th>}
                          <th className="n">Giao lần này</th>
                        </tr>
                      </thead>
                      <tbody>
                        {d.vat_tu.map((v) => {
                          const dv = nhanDonVi(v.don_vi);
                          const giao = docSoVi(f.vatTu[v.lsx_cong_doan_vat_tu_id] ?? "") ?? 0;
                          const thieuTon = v.ton != null && giao > v.ton ? giao - v.ton : 0;
                          return (
                            <tr key={v.lsx_cong_doan_vat_tu_id}>
                              <td>{v.ten ?? v.ma}{v.kho_rong > 0 && <span className="tgc-u">Khổ {nhanKho(v.kho_rong, v.kho_dai)}</span>}</td>
                              <td className="n">{so(v.dinh_muc)} <span className="tgc-mu">{dv}</span></td>
                              <td className="n">{v.da_giao > 0 ? so(v.da_giao) : <span className="tgc-mu">0</span>}</td>
                              {moi.xem_ton && (
                                <td className={`n${v.ton === 0 ? " tgc-canh" : ""}`}>{so(v.ton ?? 0)} <span className="tgc-mu">{dv}</span></td>
                              )}
                              <td className="n tgc-pg-vt__giao">
                                <span className="tgc-f__khung">
                                  <OGoDinhDang inputMode="decimal" value={f.vatTu[v.lsx_cong_doan_vat_tu_id] ?? ""} placeholder="0"
                                    aria-label={`Giao ${v.ten ?? v.ma}`}
                                    onChange={(e) => sua(d.don_dong_id, { vatTu: { ...f.vatTu, [v.lsx_cong_doan_vat_tu_id]: vietSoGo(e.target.value) } })} />
                                  <span className="tgc-f__hau">{dv}</span>
                                </span>
                                {thieuTon > 0 && <span className="tgc-u tgc-canh">Kho thiếu {so(thieuTon)} {dv}</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {d.giay && (
                  <GiayXuongCap d={d} f={f} xemTon={moi.xem_ton} onSua={(p) => sua(d.don_dong_id, p)} />
                )}

                {!btp && d.vat_tu.length === 0 && !d.giay && (
                  <p className="tgc-u">Việc này không có bán thành phẩm, vật tư hay giấy phải giao.</p>
                )}
              </section>
            );
          })}
          <label className="tgc-f__o">
            <span className="tgc-f__nhan">Ghi chú</span>
            <textarea rows={2} value={ghiChu} onChange={(e) => setGhiChu(e.target.value)} placeholder="Xe giao, người nhận bên nhà gia công…" />
          </label>
        </div>
      )}
    </DetailModal>
  );
}
