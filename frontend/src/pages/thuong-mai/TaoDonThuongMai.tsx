// Trang Tạo đơn thương mại — chỉ In Hà Phương (docs/design-hang-thuong-mai-ha-phuong.md §6, phương án C).
// Khuôn trang Tạo đơn hàng của Sapo: trái là Mặt hàng + Xuất hàng, phải là Khách hàng + Thanh toán kiểu
// quầy + Ghi chú. Một lần bấm: tạo, chốt, xuất hết hàng, lập phiếu thu theo đơn (`POST /api/thuong-mai/ban-nhanh`).
import { useEffect, useMemo, useState } from "react";
import { ApiError, type OrderDetail } from "../../api/client";
import { thuongMaiApi, type DongThuongMaiInput, type KhoXuat } from "../../api/thuongMai";
import { useAuth } from "../../auth/useAuth";
import { useCan, useTat } from "../../auth/permissions";
import { OGoDinhDang } from "../../components/OGoDinhDang";
import { soVN } from "../../components/LuoiDs";
import { boCachGiao, CACH_GIAO_TRONG, ChonCachGiao, loiCachGiao, type CachGiao } from "../giao-hang-hp/ChonCachGiao";
import { useTaiKhoanNhan } from "../ke-toan/phieu-thu/shared/taiKhoanNhan";
import {
  ChonHang, ChonKhach, chuSo, dongMoi, dvtCua, giaKhai, loi, useTenDvt, type Dong, type KhachChon,
} from "./DonThuongMai";
import "./don-thuong-mai.css";
import "./tao-don-thuong-mai.css";

type CachNhan = "cash" | "bank_transfer";

const soLe = (v: number) => Number(v.toFixed(3)).toLocaleString("vi-VN");
const tienO = (s: string) => (s ? Number(s).toLocaleString("vi-VN") : "");

/** Mức gợi ý tiền khách đưa: đúng số, làm tròn lên chục nghìn, trăm nghìn, năm trăm nghìn. */
export function mucGoiY(tong: number): number[] {
  if (tong <= 0) return [];
  const len = (b: number) => Math.ceil(tong / b) * b;
  return [tong, len(10_000), len(100_000), len(500_000)].filter((v, i, a) => a.indexOf(v) === i);
}

/** Chữ nút chính theo hai lựa chọn Thanh toán và Xuất hàng. */
export function nhanNutChinh(traNgay: boolean, xuatNgay: boolean): string {
  if (traNgay && xuatNgay) return "Tạo, chốt, xuất hàng và thu tiền";
  if (traNgay) return "Tạo, chốt và thu tiền";
  if (xuatNgay) return "Tạo, chốt và xuất hàng";
  return "Tạo và chốt đơn";
}

export function TaoDonThuongMai({ onClose, onSaved, onDoDang }: {
  onClose: () => void;
  /** Lưu xong (nháp hoặc đã chốt) — mở ngăn đơn. */
  onSaved: (d: OrderDetail) => void;
  /** Đơn đã tạo nhưng bước sau hỏng — nạp lại danh sách để thấy đơn. */
  onDoDang: () => void;
}) {
  const { token } = useAuth();
  const can = useCan();
  const tat = useTat();
  const tenDvt = useTenDvt();
  const thuDuoc = can("phieu_thu", "create");
  const coCachGiao = !tat("giao_hang_hp");

  const [khach, setKhach] = useState<KhachChon | null>(null);
  const [dong, setDong] = useState<Dong[]>([dongMoi()]);
  const [ghiChu, setGhiChu] = useState("");
  // Thanh toán
  const [traNgay, setTraNgay] = useState(thuDuoc);
  const [cachNhan, setCachNhan] = useState<CachNhan>("cash");
  const [dua, setDua] = useState("");
  const [duaSua, setDuaSua] = useState(false);
  const [tkId, setTkId] = useState<number | null>(null);
  const [maGd, setMaGd] = useState("");
  const [coc, setCoc] = useState("");
  const { taiKhoan, dangTai, loiTai } = useTaiKhoanNhan("VND");
  // Xuất hàng
  const [xuatNgay, setXuatNgay] = useState(true);
  const [khos, setKhos] = useState<KhoXuat[]>([]);
  const [khoId, setKhoId] = useState<number | null>(null);
  const [ghiSo, setGhiSo] = useState(true);
  const [cach, setCach] = useState<CachGiao>(CACH_GIAO_TRONG);
  const kho = khos.find((k) => k.id === khoId) ?? null;
  // Tồn từng dòng theo ĐVT của dòng: khoá `${hang_id}|${dvt}`. Nhớ kèm kho đã hỏi để
  // lúc vừa đổi kho không hiện tên kho mới với số của kho cũ.
  const [tonHoi, setTonHoi] = useState<{ kho: number | null; so: Record<string, number> }>({ kho: null, so: {} });

  const [luu, setLuu] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    thuongMaiApi.khoXuat(token).then((ds) => { setKhos(ds); setKhoId((cu) => cu ?? ds[0]?.id ?? null); })
      .catch((e) => setErr(loi(e, "Không tải được danh sách kho.")));
  }, [token]);

  const khoaTon = dong.filter((d) => d.hang && d.dvt).map((d) => `${d.hang!.id}|${d.dvt}`).sort().join(",");
  const khoTon = xuatNgay ? khoId : null;
  useEffect(() => {
    if (!token || !khoaTon) { setTonHoi({ kho: khoTon, so: {} }); return; }
    const lines = khoaTon.split(",").map((k) => { const [id, dvt] = k.split("|"); return { hang_id: Number(id), dvt, qty: 1 }; });
    let bo = false;
    const t = window.setTimeout(() => {
      thuongMaiApi.ton(token, khoTon, lines)
        .then((r) => { if (!bo) setTonHoi({ kho: khoTon, so: Object.fromEntries(r.map((x) => [`${x.hang_id}|${x.dvt}`, x.ton])) }); })
        .catch(() => { if (!bo) setTonHoi({ kho: khoTon, so: {} }); });
    }, 200);
    return () => { bo = true; window.clearTimeout(t); };
  }, [token, khoaTon, khoTon]);
  const ton = tonHoi.kho === khoTon ? tonHoi.so : {};

  const sua = (k: number, p: Partial<Dong>) => setDong((ds) => ds.map((d) => (d.khoa === k ? { ...d, ...p } : d)));
  const giaDong = (d: Dong) => (d.gia !== "" ? Number(d.gia) : giaKhai(d));
  const tong = useMemo(() => dong.reduce((t, d) => {
    const g = d.gia !== "" ? Number(d.gia) : giaKhai(d);
    const sl = Number(d.qty) || 0;
    return g == null ? t : t + Math.floor((g * sl * (100 + (Number(d.vat) || 0))) / 100);
  }, 0), [dong]);

  // Tiền khách đưa bám theo tổng cho tới khi người bán tự gõ.
  useEffect(() => { if (!duaSua) setDua(tong > 0 ? String(tong) : ""); }, [tong, duaSua]);
  const soDua = Number(dua || 0);
  const phieuGhi = Math.min(soDua, tong);
  const traLai = cachNhan === "cash" ? Math.max(0, soDua - tong) : 0;
  const conPhaiThu = Math.max(0, tong - phieuGhi);
  const nutChinh = nhanNutChinh(traNgay, xuatNgay);

  function dongGui(): DongThuongMaiInput[] | null {
    if (!khach) { setErr("Chọn khách hàng cho đơn."); return null; }
    const lines: DongThuongMaiInput[] = [];
    for (const d of dong) {
      if (!d.hang) { setErr("Còn dòng chưa chọn mặt hàng."); return null; }
      const sl = Number(d.qty);
      if (!Number.isInteger(sl) || sl <= 0) { setErr(`Số lượng của «${d.hang.ten}» phải là số nguyên lớn hơn 0.`); return null; }
      if (giaDong(d) == null) { setErr(`«${d.hang.ten}» chưa có giá bán theo đơn vị này, gõ đơn giá.`); return null; }
      lines.push({ hang_id: d.hang.id, dvt: d.dvt, qty: sl, don_gia: d.gia !== "" ? Number(d.gia) : null, vat_pct: Number(d.vat) || 0 });
    }
    return lines;
  }

  async function luuNhap() {
    if (!token || luu) return;
    const lines = dongGui();
    if (!lines || !khach) return;
    setLuu(true);
    setErr(null);
    try {
      onSaved(await thuongMaiApi.taoDon(token, { customer_id: khach.id, lines,
        deposit_amount: !traNgay && coc ? Number(coc) : null, ghi_chu: ghiChu.trim() || null }));
    } catch (e) {
      setErr(loi(e, "Không lưu được đơn."));
    } finally {
      setLuu(false);
    }
  }

  async function taoVaChot() {
    if (!token || luu) return;
    const lines = dongGui();
    if (!lines || !khach) return;
    if (traNgay) {
      if (phieuGhi <= 0) { setErr(cachNhan === "cash" ? "Gõ số tiền khách đưa." : "Gõ số tiền nhận."); return; }
      if (cachNhan === "bank_transfer" && !tkId) { setErr("Chọn tài khoản nhận tiền."); return; }
      if (cachNhan === "bank_transfer" && !maGd.trim()) { setErr("Nhập mã giao dịch chuyển khoản."); return; }
    }
    if (xuatNgay) {
      if (!khoId) { setErr("Chọn kho xuất."); return; }
      const thieuCach = coCachGiao ? loiCachGiao(cach) : null;
      if (thieuCach) { setErr(thieuCach); return; }
    }
    setLuu(true);
    setErr(null);
    try {
      onSaved(await thuongMaiApi.banNhanh(token, {
        customer_id: khach.id, lines, ghi_chu: ghiChu.trim() || null,
        deposit_amount: !traNgay && coc ? Number(coc) : null,
        thu: traNgay ? { receipt_method: cachNhan, amount: phieuGhi,
          company_bank_account_id: cachNhan === "bank_transfer" ? tkId : null,
          bank_reference: cachNhan === "bank_transfer" ? maGd.trim() : null } : null,
        xuat: xuatNgay && khoId ? { kho_id: khoId, ghi_so: !!kho?.ghi_so_duoc && ghiSo,
          ...(coCachGiao ? { phuong_thuc: boCachGiao(cach) } : {}) } : null,
      }));
    } catch (e) {
      setErr(loi(e, "Không tạo được đơn."));
      if (e instanceof ApiError && e.status === 409) onDoDang();
    } finally {
      setLuu(false);
    }
  }

  const nut = (
    <>
      <button type="button" className="btn btn--secondary" onClick={onClose} disabled={luu}>Hủy</button>
      <button type="button" className="btn btn--secondary" onClick={luuNhap} disabled={luu}>Lưu nháp</button>
      <button type="button" className="btn btn--primary" onClick={taoVaChot} disabled={luu}>{luu ? "Đang lưu…" : nutChinh}</button>
    </>
  );

  return (
    <main className="tdtm" aria-label="Tạo đơn thương mại">
      <header className="tdtm__dau">
        <button type="button" className="tdtm__lui" onClick={onClose} disabled={luu}>← Đơn hàng bán</button>
        <h1 className="tdtm__ten">Tạo đơn thương mại</h1>
        <div className="tdtm__nut">{nut}</div>
      </header>
      {err && <div className="banner banner--error" role="alert">{err}</div>}

      <div className="tdtm__than">
        <div className="tdtm__cot">
          <section className="tdtm__the" aria-label="Mặt hàng">
            <h2 className="tdtm__tieu">Mặt hàng</h2>
            <div className="tdtm__cuon">
              <table className="dhb__g dtm__bang">
                <thead>
                  <tr>
                    <th>Mặt hàng</th>
                    <th>Đơn vị</th>
                    <th className="dhb__text-right">Số lượng</th>
                    <th className="dhb__text-right">Đơn giá</th>
                    <th className="dhb__text-right">VAT %</th>
                    <th className="dhb__text-right">Thành tiền</th>
                    <th aria-label="Xoá dòng" />
                  </tr>
                </thead>
                <tbody>
                  {dong.map((d) => {
                    const g = giaDong(d);
                    const sl = Number(d.qty) || 0;
                    const t = d.hang && d.dvt ? ton[`${d.hang.id}|${d.dvt}`] : undefined;
                    const thieu = xuatNgay && t != null && t < sl ? sl - t : 0;
                    return (
                      <tr key={d.khoa}>
                        <td className="dtm__c-hang">
                          <ChonHang value={d.hang} onChange={(h) => sua(d.khoa, { hang: h, dvt: h.don_vi_gia, gia: "" })} />
                          {t != null && (
                            <span className={`tdtm__ton${thieu > 0 ? " is-thieu" : ""}`}>
                              {`${xuatNgay && kho ? kho.ten : "Mọi kho"} còn ${soLe(t)} ${tenDvt(d.dvt)}`}
                              {thieu > 0 ? `, thiếu ${soLe(thieu)}` : ""}
                            </span>
                          )}
                        </td>
                        <td>
                          <select className="dhb__input" aria-label="Đơn vị" value={d.dvt} disabled={!d.hang}
                            onChange={(e) => sua(d.khoa, { dvt: e.target.value, gia: "" })}>
                            {(d.hang ? dvtCua(d.hang) : []).map((m) => <option key={m} value={m}>{tenDvt(m)}</option>)}
                          </select>
                        </td>
                        <td>
                          <input className="dhb__input dhb__text-right" inputMode="numeric" aria-label="Số lượng" value={d.qty}
                            onChange={(e) => sua(d.khoa, { qty: chuSo(e.target.value) })} />
                        </td>
                        <td>
                          <OGoDinhDang className="dhb__input dhb__text-right" inputMode="numeric" aria-label="Đơn giá"
                            placeholder={giaKhai(d) != null ? soVN(giaKhai(d)!) : "Gõ giá"}
                            value={tienO(d.gia)} onChange={(e) => sua(d.khoa, { gia: chuSo(e.target.value) })} />
                        </td>
                        <td>
                          <input className="dhb__input dhb__text-right" inputMode="numeric" aria-label="VAT" value={d.vat}
                            onChange={(e) => sua(d.khoa, { vat: chuSo(e.target.value).slice(0, 3) })} />
                        </td>
                        <td className="dhb__mono dhb__text-right">{g == null ? "—" : soVN(g * sl)}</td>
                        <td>
                          {dong.length > 1 && (
                            <button type="button" className="btn btn--ghost" aria-label="Xoá dòng"
                              onClick={() => setDong((ds) => ds.filter((x) => x.khoa !== d.khoa))}>×</button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <button type="button" className="btn btn--secondary dtm__them" onClick={() => setDong((ds) => [...ds, dongMoi()])}>Thêm mặt hàng</button>
            <div className="tdtm__tong"><span>Tổng gồm VAT</span><span>{soVN(tong)}</span></div>
          </section>

          <section className="tdtm__the" aria-label="Xuất hàng">
            <h2 className="tdtm__tieu">Xuất hàng</h2>
            <div className="tdtm__hai-chon" role="radiogroup" aria-label="Xuất hàng">
              <ThePhai on={xuatNgay} onChon={() => setXuatNgay(true)} ten="Xuất ngay" mo="Khách lấy hàng hoặc giao ngay" />
              <ThePhai on={!xuatNgay} onChon={() => setXuatNgay(false)} ten="Xuất sau" mo="Chốt đơn, xuất ở ngăn đơn khi có hàng" />
            </div>
            {xuatNgay && (
              <>
                <div className="tdtm__hang">
                  <label className="dtm__o">
                    <span>Kho xuất <b>*</b></span>
                    <select className="dhb__input" aria-label="Kho xuất" value={khoId ?? ""} onChange={(e) => setKhoId(Number(e.target.value) || null)}>
                      {khos.length === 0 && <option value="">Chưa có kho</option>}
                      {khos.map((k) => <option key={k.id} value={k.id}>{k.ten}</option>)}
                    </select>
                  </label>
                  {kho?.ghi_so_duoc ? (
                    <label className="dtm__check tdtm__ghi-so">
                      <input type="checkbox" checked={ghiSo} onChange={(e) => setGhiSo(e.target.checked)} />
                      <span>Ghi sổ kho luôn (hàng trừ tồn ngay, khỏi qua màn Kho)</span>
                    </label>
                  ) : (
                    <p className="dtm__lead tdtm__ghi-so">Yêu cầu xuất sẽ gửi tới người giữ kho {kho?.ten ?? ""}.</p>
                  )}
                </div>
                {coCachGiao && <ChonCachGiao value={cach} onChange={setCach} oInput="dhb__input" />}
                <p className="dtm__lead">Xuất ngay là xuất hết số lượng của đơn. Muốn xuất một phần thì chọn Xuất sau.</p>
              </>
            )}
          </section>
        </div>

        <div className="tdtm__cot">
          <section className="tdtm__the" aria-label="Khách hàng">
            <h2 className="tdtm__tieu">Khách hàng <b className="tdtm__sao">*</b></h2>
            {khach ? (
              <div className="tdtm__khach">
                <div><span>{khach.name}</span><button type="button" className="tdtm__doi" onClick={() => setKhach(null)}>Đổi</button></div>
                {(khach.code || khach.phone) && <small>{[khach.code, khach.phone].filter(Boolean).join(" ")}</small>}
              </div>
            ) : (
              <ChonKhach value={null} onChange={setKhach} />
            )}
          </section>

          <section className="tdtm__the" aria-label="Thanh toán">
            <h2 className="tdtm__tieu">Thanh toán</h2>
            {thuDuoc && (
              <div className="tdtm__hai-chon" role="radiogroup" aria-label="Thanh toán">
                <ThePhai on={traNgay} onChon={() => setTraNgay(true)} ten="Khách trả ngay" />
                <ThePhai on={!traNgay} onChon={() => setTraNgay(false)} ten="Thanh toán sau" />
              </div>
            )}
            {traNgay ? (
              <>
                <div className="tdtm__tong"><span>Khách phải trả</span><span>{soVN(tong)}</span></div>
                <div className="tdtm__nhan" role="radiogroup" aria-label="Nhận bằng">
                  {(["cash", "bank_transfer"] as const).map((c) => (
                    <button key={c} type="button" role="radio" aria-checked={cachNhan === c}
                      className={cachNhan === c ? "is-on" : ""} onClick={() => setCachNhan(c)}>
                      {c === "cash" ? "Tiền mặt" : "Chuyển khoản"}
                    </button>
                  ))}
                </div>
                <label className="dtm__o">
                  <span>{cachNhan === "cash" ? "Tiền khách đưa" : "Số tiền nhận"}</span>
                  <OGoDinhDang className="dhb__input tdtm__dua" inputMode="numeric"
                    aria-label={cachNhan === "cash" ? "Tiền khách đưa" : "Số tiền nhận"}
                    value={tienO(dua)} onChange={(e) => { setDuaSua(true); setDua(chuSo(e.target.value)); }} />
                </label>
                {cachNhan === "cash" ? (
                  <div className="tdtm__goi-y" aria-label="Mức gợi ý">
                    {mucGoiY(tong).map((m) => (
                      <button key={m} type="button" onClick={() => { setDuaSua(true); setDua(String(m)); }}>{soVN(m)}</button>
                    ))}
                  </div>
                ) : (
                  <>
                    <label className="dtm__o">
                      <span>Tài khoản nhận <b>*</b></span>
                      <select className="dhb__input" value={tkId ?? ""} disabled={dangTai || taiKhoan.length === 0}
                        onChange={(e) => setTkId(Number(e.target.value) || null)}>
                        <option value="">{dangTai ? "Đang tải…" : taiKhoan.length === 0 ? "Chưa có tài khoản nhận" : "Chọn tài khoản…"}</option>
                        {taiKhoan.map((t) => <option key={t.id} value={t.id}>{`${t.account_number} ${t.bank_name}`}</option>)}
                      </select>
                      {loiTai && <small className="tdtm__goi">{loiTai}</small>}
                    </label>
                    <label className="dtm__o">
                      <span>Mã giao dịch <b>*</b></span>
                      <input className="dhb__input" maxLength={64} value={maGd} placeholder="Mã trên sao kê hoặc tin nhắn báo có"
                        onChange={(e) => setMaGd(e.target.value)} />
                    </label>
                  </>
                )}
                <div className="tdtm__tom">
                  {cachNhan === "cash" && <div><span>Trả lại khách</span><span>{soVN(traLai)}</span></div>}
                  <div><span>Phiếu thu ghi</span><span>{soVN(phieuGhi)}</span></div>
                  <div className="is-tong"><span>Còn phải thu</span><span>{soVN(conPhaiThu)}</span></div>
                </div>
                <p className="dtm__lead">
                  Người nộp là tên khách, ngày thu hôm nay. Phần còn thiếu thu sau ở chặng Thu tiền của đơn.
                </p>
              </>
            ) : (
              <label className="dtm__o">
                <span>Tiền cọc</span>
                <OGoDinhDang className="dhb__input" inputMode="numeric" aria-label="Tiền cọc" placeholder="Không cọc"
                  value={tienO(coc)} onChange={(e) => setCoc(chuSo(e.target.value))} />
              </label>
            )}
          </section>

          <section className="tdtm__the" aria-label="Ghi chú">
            <h2 className="tdtm__tieu">Ghi chú</h2>
            <textarea className="dhb__input tdtm__ghi-chu" maxLength={1000} aria-label="Ghi chú" value={ghiChu}
              onChange={(e) => setGhiChu(e.target.value)} />
          </section>
        </div>
      </div>

      <footer className="tdtm__chan">{nut}</footer>
    </main>
  );
}

function ThePhai({ on, onChon, ten, mo }: { on: boolean; onChon: () => void; ten: string; mo?: string }) {
  return (
    <button type="button" role="radio" aria-checked={on} aria-label={ten} className={`tdtm__chon${on ? " is-on" : ""}`}
      onClick={onChon}>
      <span>{ten}</span>
      {mo && <small>{mo}</small>}
    </button>
  );
}
