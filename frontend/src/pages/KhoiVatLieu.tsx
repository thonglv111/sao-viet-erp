import { useCallback, useEffect, useRef, useState } from "react";
import { api, type DoiVatLieuBody, type LsxDetail, type PhuongAnLay, type VatLieuDauVao, type VatLieuDauVaoMon } from "../api/client";

/** Khối "Vật liệu đầu vào" đầu tab Công đoạn (12/11/2026, mockup docs/mockups/chuan-bi-vat-lieu.html).
 *
 *  Máy chủ chấm điểm các khổ đang có trong kho (đủ tồn 50, ít bước chuẩn bị 30, ít thừa giấy 20) và đã
 *  chọn sẵn phương án đầu lúc lập lệnh. Người kế hoạch đổi được: máy chủ dựng lại bước Cắt giấy cuộn /
 *  Tề giấy in / Tề sóng. FE không tự tính điểm hay bước — chỉ hiện và gửi lựa chọn. Thiếu thì chỉ báo
 *  "thiếu", việc mua do Kế hoạch vật tư lo. */

const so = (n: number) => Math.round(n).toLocaleString("vi-VN");
const dv = (d: "to" | "kg") => (d === "kg" ? "kg" : "tờ");
const khoTxt = (w: number, h: number) => `${so(w)} × ${so(h)}`;
const tenPa = (p: PhuongAnLay) => (p.dang === "cuon" ? `Cuộn rộng ${so(p.rong)}` : `Tờ ${khoTxt(p.rong, p.dai)}`);
const cungKho = (a: PhuongAnLay | null, b: PhuongAnLay) => !!a && a.dang === b.dang && a.rong === b.rong && a.dai === b.dai;
const lopDiem = (d: number) => (d >= 80 ? " is-cao" : d < 70 ? " is-thap" : "");

interface Props {
  lsxId: number;
  token: string | null;
  /** Câu khoá phía màn (không quyền, đang sửa chuỗi chưa lưu); null = không khoá. */
  khoaNgoai: string | null;
  /** Đổi giá trị ⇒ tải lại (vd sau khi lưu chuỗi công đoạn, số tờ cần đổi). */
  phienBan: string | number;
  onDoi: (lsx: LsxDetail) => void;
}

export function KhoiVatLieu({ lsxId, token, khoaNgoai, phienBan, onDoi }: Props) {
  const [data, setData] = useState<VatLieuDauVao | null>(null);
  const [mo, setMo] = useState<"giay" | "song" | null>(null);
  const [dang, setDang] = useState(false);
  const [loi, setLoi] = useState<string | null>(null);
  const goc = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!token) return;
    let bo = false;
    api.lsx.vatLieuDauVao(token, lsxId)
      .then((r) => { if (!bo) setData(r); })
      .catch((e: unknown) => { if (!bo) setLoi(e instanceof Error ? e.message : String(e)); });
    return () => { bo = true; };
  }, [token, lsxId, phienBan]);

  useEffect(() => {
    if (!mo) return;
    const dong = (e: MouseEvent) => { if (goc.current && !goc.current.contains(e.target as Node)) setMo(null); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setMo(null); };
    document.addEventListener("mousedown", dong);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", dong); document.removeEventListener("keydown", esc); };
  }, [mo]);

  const gui = useCallback(async (body: DoiVatLieuBody) => {
    if (!token) return;
    setDang(true);
    setLoi(null);
    setMo(null);
    try {
      const lsx = await api.lsx.doiVatLieu(token, lsxId, body);
      onDoi(lsx);
      setData(await api.lsx.vatLieuDauVao(token, lsxId));
    } catch (e: unknown) {
      setLoi(e instanceof Error ? e.message : String(e));
    } finally {
      setDang(false);
    }
  }, [token, lsxId, onDoi]);

  if (!data || (!data.giay && !data.song)) {
    return loi ? <div className="khsx-note-banner khsx-note-banner--error" role="alert">{loi}</div> : null;
  }
  const khoa = khoaNgoai ?? data.khoa;

  const dong = (k: "giay" | "song", m: VatLieuDauVaoMon) => {
    const p = m.dang_lay;
    const tat = !!khoa || dang || m.tu_khai;
    return (
      <tr key={k}>
        <td>
          <span className={`khsx-vl__loai khsx-vl__loai--${k}`}>{k === "giay" ? "Giấy in" : "Sóng"}</span>
          <span className="khsx-vl__ten">{m.ten_hang}</span>
        </td>
        <td>
          {m.tu_khai ? (
            <span className="khsx-vl__chu">Lệnh tự khai bước chuẩn bị, không đổi ở đây</span>
          ) : (
            <div className="khsx-vl__chon">
              <button
                type="button"
                className={`khsx-vl__nut${mo === k ? " is-mo" : ""}`}
                aria-haspopup="listbox"
                aria-expanded={mo === k}
                aria-label={k === "giay" ? "Khổ giấy in lấy ở kho" : "Khổ sóng lấy ở kho"}
                disabled={tat}
                onClick={() => setMo(mo === k ? null : k)}
              >
                {p ? tenPa(p) : "Chưa chọn"}
              </button>
              {!m.tot_nhat && !tat && (
                <button type="button" className="khsx-vl__ve" onClick={() => void gui({ vat_lieu: k, ve_tot_nhat: true })}>
                  Về phương án tốt nhất
                </button>
              )}
              {mo === k && (
                <div className="khsx-vl__hop" role="listbox" aria-label="Phương án lấy ở kho">
                  <div className="khsx-vl__pa khsx-vl__pa--dau">
                    <span />
                    <span>Khổ trong kho</span>
                    <span>Chuẩn bị</span>
                    <span className="is-phai">Tồn kho</span>
                    <span className="is-phai">Điểm</span>
                  </div>
                  {m.ds.map((x) => {
                    const chon = cungKho(p, x);
                    return (
                      <div
                        key={`${x.dang}-${x.rong}-${x.dai}`}
                        role="option"
                        aria-selected={chon}
                        tabIndex={0}
                        className={`khsx-vl__pa${chon ? " is-chon" : ""}`}
                        onClick={() => { if (!chon) void gui({ vat_lieu: k, rong: x.rong, dai: x.dai }); else setMo(null); }}
                        onKeyDown={(e) => { if (e.key === "Enter" && !chon) void gui({ vat_lieu: k, rong: x.rong, dai: x.dai }); }}
                      >
                        <span className="khsx-vl__tick" />
                        <span className="khsx-vl__so">{tenPa(x)}</span>
                        <span className={`khsx-vl__lam${x.buoc.length ? "" : " is-khop"}`}>
                          {x.buoc.length ? x.buoc.join(" rồi ") : "Đúng khổ"}
                        </span>
                        <span className="khsx-vl__ton">
                          {so(x.ton)} {dv(x.don_vi)}
                          {x.ton < x.can && <span className="khsx-vl__thieu">thiếu {so(x.can - x.ton)}</span>}
                        </span>
                        <span className={`khsx-vl__diem${lopDiem(x.diem)}`}>{x.diem}</span>
                      </div>
                    );
                  })}
                  <div className="khsx-vl__cuoi">
                    Cần {so(m.so_to_can)} tờ khổ {khoTxt(m.kho_can[0], m.kho_can[1])}. Điểm 100: đủ tồn 50, ít bước chuẩn bị 30, ít thừa giấy 20.
                  </div>
                </div>
              )}
            </div>
          )}
        </td>
        <td>
          {p && (p.buoc.length ? (
            <span className="khsx-vl__buoc">
              {p.buoc.map((b, i) => (
                <span key={b}>
                  {i > 0 && <span className="khsx-vl__roi">rồi</span>}
                  <span className="khsx-vl__chip">{b}</span>
                </span>
              ))}
            </span>
          ) : <span className="khsx-vl__khop">Không cần, đúng khổ</span>)}
        </td>
        <td>
          <span className="khsx-vl__chu">{m.vao_buoc}</span>{" "}
          <span className="khsx-vl__so">{khoTxt(m.kho_can[0], m.kho_can[1])}</span>
          {k === "song" && (
            <span className="khsx-vl__le">
              trừ lề
              <input
                key={`le-${m.tru_le_mm}`}
                aria-label="Lề trừ mỗi chiều (mm)"
                inputMode="numeric"
                defaultValue={m.tru_le_mm ?? 0}
                disabled={tat}
                onBlur={(e) => {
                  const v = Number(e.currentTarget.value.replace(/\D/g, "") || 0);
                  if (v !== (m.tru_le_mm ?? 0)) void gui({ vat_lieu: "song", tru_le_mm: v });
                }}
                onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
              />
              mm
            </span>
          )}
        </td>
        <td className="is-phai">
          {p && (p.ton >= p.can ? (
            <span className="khsx-vl__so">{so(p.ton)} / {so(p.can)} {dv(p.don_vi)}</span>
          ) : (
            <>
              <span className="khsx-vl__so is-thieu">{so(p.ton)} / {so(p.can)} {dv(p.don_vi)}</span>
              <span className="khsx-vl__thieu">thiếu {so(p.can - p.ton)}</span>
            </>
          ))}
        </td>
      </tr>
    );
  };

  return (
    <div className="khsx-vl" ref={goc}>
      <div className="khsx-vl__tieu-de">Vật liệu đầu vào</div>
      <div className="khsx-vl__khung">
        <table className="khsx-vl__bang">
          <thead>
            <tr>
              <th>Vật liệu</th>
              <th>Lấy ở kho</th>
              <th>Chuẩn bị</th>
              <th>Vào bước</th>
              <th className="is-phai">Tồn / cần</th>
            </tr>
          </thead>
          <tbody>
            {data.giay && dong("giay", data.giay)}
            {data.song && dong("song", data.song)}
          </tbody>
        </table>
      </div>
      {khoa && <div className="khsx-vl__khoa">{khoa}</div>}
      {loi && <div className="khsx-note-banner khsx-note-banner--error" role="alert">{loi}</div>}
    </div>
  );
}
