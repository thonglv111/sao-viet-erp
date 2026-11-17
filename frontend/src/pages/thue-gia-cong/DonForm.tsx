// Hộp LẬP / SỬA ĐƠN GIA CÔNG (spec 2026-11-13 §4.2). Lập: từ Hàng chờ tick nhiều việc (nhiều lệnh) →
// chọn nhà gia công, ngày đặt, hẹn về; số đặt điền sẵn số cần; đơn giá gợi ý theo lần trước cùng nhà +
// cùng tên việc; tạm tính = số × giá. Lưu nháp hoặc Đặt hàng. Sửa: đơn đã đặt không đổi nhà / ngày đặt,
// dòng đã có phiếu giao hoặc phiếu nhận không bỏ được (máy chủ chặn cùng luật).
// Việc còn chờ bước trước vẫn đặt được (đặt trước để chốt nhà, giá, hẹn về — spec §6 kịch bản 1); hộp
// chỉ nói rõ điều đó, vì phiếu giao mới là chỗ chặn: chỉ mang đi đúng số bước trước đã bàn giao.
import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { ApiError } from "../../api/client";
import {
  tgcApi, type TgcDon, type TgcHangChoDong, type TgcKieu, type TgcLenh,
} from "../../api/thueGiaCong";
import { useAuth } from "../../auth/useAuth";
import { ChonNgay } from "../../components/ChonNgay";
import { DetailModal } from "../../components/DetailModal";
import { OGoDinhDang } from "../../components/OGoDinhDang";
import { homNayVN } from "../../utils/ky";
import { nhanChang } from "../lsxBuoc";
import { ChonNhaGiaCong } from "./ChonNhaGiaCong";
import { docSoVi, so, tamTinh, tien, vietSoGo } from "./tgc";
import "./thue-gia-cong.css";

interface DongForm {
  viec_id: number;
  ten_viec: string;
  kieu: TgcKieu;
  lenh: TgcLenh[];
  bai_ghep_ma: string | null;
  don_vi: string | null;
  sl_can: number | null;
  sl: string;
  gia: string;
  /** Đơn giá lần trước cùng nhà + cùng tên việc (null = chưa từng). */
  goiY: number | null;
  /** Dòng đã có phiếu giao / nhận ⇒ không bỏ được. */
  khoa: boolean;
  /** Trọn gói: xưởng cấp giấy (true) hay nhà gia công tự lo (false); việc khác null. */
  capGiay: boolean | null;
  /** Đã có phiếu giao ⇒ không đổi cách cấp giấy (máy chủ chặn đúng khi phiếu giao mang giấy). */
  khoaGiay: boolean;
  /** Lập từ Hàng chờ: việc còn chờ tổ bước trước bàn giao. */
  choBuocTruoc: boolean;
}

const tuViec = (v: TgcHangChoDong): DongForm => ({
  viec_id: v.viec_id, ten_viec: v.ten_viec, kieu: v.kieu, lenh: v.lenh, bai_ghep_ma: v.bai_ghep_ma,
  don_vi: v.don_vi, sl_can: v.sl_can, sl: v.sl_can != null ? vietSoGo(String(v.sl_can).replace(".", ",")) : "",
  gia: "", goiY: null, khoa: false,
  capGiay: v.kieu === "tron_goi" ? v.xuong_cap_giay : null, khoaGiay: false,
  choBuocTruoc: v.tinh_trang === "cho_buoc_truoc",
});

const tuDonDong = (d: TgcDon["dong"][number]): DongForm => ({
  viec_id: d.viec_id, ten_viec: d.ten_viec, kieu: d.kieu, lenh: d.lenh, bai_ghep_ma: d.bai_ghep_ma,
  don_vi: d.don_vi, sl_can: d.sl_can, sl: vietSoGo(String(d.sl_dat).replace(".", ",")),
  gia: vietSoGo(String(d.don_gia).replace(".", ",")), goiY: null,
  khoa: d.co_giao || d.co_nhan || d.hoan_tat_luc != null,
  capGiay: d.kieu === "tron_goi" ? d.xuong_cap_giay : null, khoaGiay: d.co_giao, choBuocTruoc: false,
});

export function DonForm({
  viecs,
  don,
  onClose,
  onDone,
}: {
  /** Lập mới từ các việc đã tick ở Hàng chờ. */
  viecs?: TgcHangChoDong[];
  /** Sửa đơn có sẵn. */
  don?: TgcDon;
  onClose: () => void;
  onDone: (don: TgcDon) => void;
}) {
  const { token } = useAuth();
  const sua = don != null;
  const daDat = don?.dat_luc != null;
  const [nhaId, setNhaId] = useState<number | null>(don?.nha_cung_cap_id ?? null);
  const [ngayDat, setNgayDat] = useState(don?.ngay_dat ?? homNayVN());
  const [henVe, setHenVe] = useState(don?.ngay_hen_ve ?? "");
  const [ghiChu, setGhiChu] = useState(don?.ghi_chu ?? "");
  const [dong, setDong] = useState<DongForm[]>(() =>
    don ? don.dong.filter((d) => d.huy_luc == null).map(tuDonDong) : (viecs ?? []).map(tuViec));
  const [busy, setBusy] = useState<"nhap" | "dat" | "luu" | null>(null);
  const [loi, setLoi] = useState<string | null>(null);

  // Gợi ý đơn giá mỗi lần đổi nhà: dòng còn trống giá thì điền luôn, dòng đã gõ chỉ hiện gợi ý.
  const tenViecs = useMemo(() => [...new Set(dong.map((d) => d.ten_viec))].join("\n"), [dong]);
  useEffect(() => {
    if (!token || nhaId == null) return;
    let alive = true;
    const ten = tenViecs.split("\n").filter(Boolean);
    Promise.all(ten.map((t) => tgcApi.goiYDonGia(token, nhaId, t, don?.id).then((r) => [t, r.don_gia] as const)))
      .then((cap) => {
        if (!alive) return;
        const m = new Map(cap);
        setDong((ds) => ds.map((d) => {
          const g = m.get(d.ten_viec) ?? null;
          return { ...d, goiY: g, gia: d.gia === "" && g != null ? vietSoGo(String(g).replace(".", ",")) : d.gia };
        }));
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [token, nhaId, tenViecs]);

  const sua1 = (i: number, p: Partial<DongForm>) => setDong((ds) => ds.map((d, j) => (j === i ? { ...d, ...p } : d)));
  const tong = dong.reduce((s, d) => s + tamTinh(docSoVi(d.sl), docSoVi(d.gia)), 0);
  const thieu =
    nhaId == null ? "Chọn nhà gia công."
      : !ngayDat ? "Chọn ngày đặt."
        : henVe && henVe < ngayDat ? "Ngày hẹn về không được trước ngày đặt."
          : dong.length === 0 ? "Đơn chưa có việc nào."
            : dong.some((d) => !((docSoVi(d.sl) ?? 0) > 0)) ? "Số đặt mỗi dòng phải lớn hơn 0."
              : null;

  async function luu(kieu: "nhap" | "dat" | "luu") {
    if (!token || thieu || nhaId == null) return;
    setBusy(kieu);
    setLoi(null);
    const body = {
      nha_cung_cap_id: nhaId, ngay_dat: ngayDat, ngay_hen_ve: henVe || null, ghi_chu: ghiChu.trim() || null,
      dong: dong.map((d) => ({
        viec_id: d.viec_id, sl_dat: docSoVi(d.sl) ?? 0, don_gia: docSoVi(d.gia) ?? 0,
        ...(d.capGiay != null ? { xuong_cap_giay: d.capGiay } : {}),
      })),
    };
    try {
      const r = sua && don
        ? await tgcApi.suaDon(token, don.id, { ...body, version: don.version })
        : await tgcApi.taoDon(token, { ...body, dat: kieu === "dat" });
      onDone(r);
    } catch (e) {
      setLoi(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const coTronGoi = dong.some((d) => d.capGiay != null);
  const coChoBuocTruoc = dong.some((d) => d.choBuocTruoc);
  // Cột nút bỏ dòng chỉ khi có dòng bỏ được — đơn một việc khỏi chừa cột trống.
  const coBo = dong.length > 1 && dong.some((d) => !d.khoa);
  const soCotTruocTong = coTronGoi ? 5 : 4;

  return (
    <DetailModal
      title={sua && don ? `Sửa đơn ${don.ma}` : "Lập đơn gia công"}
      width={coTronGoi ? 1040 : 960}
      onClose={onClose}
      footer={
        <>
          {loi && <span className="tgc-f__loi" role="alert">{loi}</span>}
          {!loi && thieu && <span className="tgc-f__goi-y">{thieu}</span>}
          <span className="kcsb-gian" />
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy != null}>Đóng</button>
          {sua ? (
            <button type="button" className="btn btn--primary" disabled={!!thieu || busy != null} onClick={() => luu("luu")}>
              {busy === "luu" ? "Đang lưu…" : "Lưu thay đổi"}
            </button>
          ) : (
            <>
              <button type="button" className="btn btn--ghost" disabled={!!thieu || busy != null} onClick={() => luu("nhap")}>
                {busy === "nhap" ? "Đang lưu…" : "Lưu nháp"}
              </button>
              <button type="button" className="btn btn--primary" disabled={!!thieu || busy != null} onClick={() => luu("dat")}>
                {busy === "dat" ? "Đang đặt…" : "Đặt hàng"}
              </button>
            </>
          )}
        </>
      }
    >
      <div className="tgc-f">
        <div className="tgc-f__hang3">
          <div className="tgc-f__o">
            <span className="tgc-f__nhan">Nhà gia công</span>
            <ChonNhaGiaCong token={token} value={nhaId} onChange={setNhaId} disabled={daDat}
              tenCu={don?.nha_cung_cap_id === nhaId ? don?.nha_cung_cap_ten : null} />
          </div>
          <label className="tgc-f__o">
            <span className="tgc-f__nhan">Ngày đặt</span>
            <ChonNgay value={ngayDat} onChange={setNgayDat} disabled={daDat} required aria-label="Ngày đặt" />
          </label>
          <label className="tgc-f__o">
            <span className="tgc-f__nhan">Hẹn về</span>
            <ChonNgay value={henVe} onChange={setHenVe} min={ngayDat} aria-label="Ngày hẹn về" />
          </label>
        </div>

        {coChoBuocTruoc && (
          <p className="tgc-f__dan">
            Việc ghi Chờ bước trước bàn giao vẫn đặt trước được để chốt nhà gia công, giá và ngày hẹn về. Hàng chỉ
            giao được khi tổ bước trước bàn giao sang.
          </p>
        )}
        <div className="tgc-cuon">
          <table className="tgc-bang tgc-bang--don">
            <thead>
              <tr>
                <th>Việc</th>
                <th>Lệnh</th>
                {coTronGoi && <th>Giấy</th>}
                <th className="n">Số đặt</th>
                <th className="n">Đơn giá</th>
                <th className="n">Tạm tính</th>
                {coBo && <th aria-label="Bỏ dòng" />}
              </tr>
            </thead>
            <tbody>
              {dong.map((d, i) => {
                const dv = nhanChang(d.don_vi);
                const gia = docSoVi(d.gia);
                return (
                  <tr key={d.viec_id}>
                    <td>
                      {d.ten_viec}
                      {/* Trọn gói: tên việc đã là "Gia công trọn gói", không nói lại. */}
                      {d.kieu !== "tron_goi" && (
                        <span className="tgc-u">{d.bai_ghep_ma ? `Bài ghép ${d.bai_ghep_ma}` : "Một phần"}</span>
                      )}
                      {d.choBuocTruoc && <span className="tgc-u">Chờ bước trước bàn giao</span>}
                    </td>
                    <td className="tgc-c-lenh">
                      {d.lenh.map((l) => (
                        <span key={l.lsx_id} className="tgc-dong-lenh">
                          {l.lsx_ma}
                          <span className="tgc-u" title={`${l.khach_hang}\n${l.mat_hang}`}>{l.khach_hang || l.mat_hang}</span>
                        </span>
                      ))}
                    </td>
                    {coTronGoi && (
                      <td>
                        {/* Hai lựa chọn hiện cả hai, mặc định nhà gia công lo (16/11/2026). */}
                        {d.capGiay != null && (
                          <div className="tgc-giay" role="radiogroup" aria-label={`Ai lo giấy cho ${d.ten_viec}`}
                            title={d.khoaGiay ? "Đã có phiếu giao — huỷ phiếu giao trước rồi mới đổi" : undefined}>
                            {([false, true] as const).map((cap) => (
                              <label key={String(cap)}>
                                <input type="radio" name={`giay-${d.viec_id}`} checked={d.capGiay === cap}
                                  disabled={d.khoaGiay} onChange={() => sua1(i, { capGiay: cap })} />
                                {cap ? "Xưởng cấp" : "Nhà gia công lo"}
                              </label>
                            ))}
                          </div>
                        )}
                      </td>
                    )}
                    <td className="n">
                      <span className="tgc-f__khung">
                        <OGoDinhDang inputMode="decimal" value={d.sl} aria-label={`Số đặt ${d.ten_viec}`}
                          onChange={(e) => sua1(i, { sl: vietSoGo(e.target.value) })} />
                        <span className="tgc-f__hau">{dv}</span>
                      </span>
                      {d.sl_can != null && docSoVi(d.sl) !== d.sl_can && (
                        <span className="tgc-u">Cần {so(d.sl_can)} {dv}</span>
                      )}
                    </td>
                    <td className="n">
                      <span className="tgc-f__khung">
                        <OGoDinhDang inputMode="decimal" value={d.gia} aria-label={`Đơn giá ${d.ten_viec}`}
                          placeholder="0" onChange={(e) => sua1(i, { gia: vietSoGo(e.target.value) })} />
                        <span className="tgc-f__hau">đ</span>
                      </span>
                      {/* Một dòng dưới ô giá: đang đúng giá lần trước thì chỉ ghi thế, khác thì bấm để dùng lại. */}
                      {d.goiY != null && gia === d.goiY && <span className="tgc-u">Theo lần trước</span>}
                      {d.goiY != null && gia !== d.goiY && (
                        <button type="button" className="tgc-f__nhanh tgc-f__nhanh--nho"
                          onClick={() => sua1(i, { gia: vietSoGo(String(d.goiY).replace(".", ",")) })}>
                          Lần trước {tien(d.goiY)}
                        </button>
                      )}
                    </td>
                    <td className="n">{tien(tamTinh(docSoVi(d.sl), gia))}</td>
                    {coBo && (
                      <td>
                        {!d.khoa && (
                          <button type="button" className="tgc-bo" aria-label={`Bỏ ${d.ten_viec} khỏi đơn`}
                            onClick={() => setDong((ds) => ds.filter((_, j) => j !== i))}>
                            <X size={14} />
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={soCotTruocTong} className="n tgc-mu">Tổng tạm tính</td>
                <td className="n tgc-bang__tong">{tien(tong)}</td>
                {coBo && <td />}
              </tr>
            </tfoot>
          </table>
        </div>

        <label className="tgc-f__o">
          <span className="tgc-f__nhan">Ghi chú</span>
          <textarea rows={2} value={ghiChu} onChange={(e) => setGhiChu(e.target.value)}
            placeholder="Yêu cầu riêng với nhà gia công" aria-label="Ghi chú đơn" />
        </label>
      </div>
    </DetailModal>
  );
}
