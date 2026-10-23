// Hộp BÁO DỪNG MÁY ở bàn tổ (Đợt 2 công thức khoán, 21/10/2026, mockup `khoan-cong-thuc-bo-sung.html`
// màn 4). Ngày máy hư / hết hàng tổ ăn chỉ tiêu ngày, chia cho người hưởng theo lương ca máy — người
// hưởng do tổ trưởng tick, tick sẵn cả tổ. Một tổ một ngày một lần: báo trùng máy chủ trả câu lỗi.
// Tick nhầm thì bấm Sửa ở dòng đã báo — hộp mở lại giá trị cũ, sửa tại chỗ (ngày giữ nguyên).
//
// GỘP BÁO SỰ CỐ (23/10/2026, mockup `bao-dung-may-gop.html`): ngăn việc bỏ "Báo sự cố", hộp này lo
// luôn. Máy hư HÔM NAY ⇒ chọn máy, tick "Máy đang dừng" (tạm dừng việc trên máy), mức độ, triệu chứng
// rồi gửi tổ sửa chữa; phần lương thành ô tick "Tính ngày dừng cho lương" (máy hư vài chục phút rồi
// chạy lại thì không ăn chỉ tiêu ngày). Máy hư ngày đã qua / Hết hàng / Sửa: chỉ còn phần lương như cũ.
//
// Quyền do máy chủ trả trong `ds` (chủ 23/10: "có quyền mới bấm được báo máy hư, chứ không phải
// hardcode tổ trưởng"): `quyen_bao_hong` (ô Báo hỏng) mở phần gửi tổ sửa chữa, `quyen_luong` (Xác nhận
// sản lượng trọn tổ) mở ngày, Hết hàng, ngày dừng, sửa, xoá. Chỉ có Báo hỏng thì hộp chỉ còn máy hư hôm nay.
import { useEffect, useId, useRef, useState } from "react";

import type {
  SxDungMay, SxDungMayIn, SxDungMayListOut, SxDungMaySuaIn, SxLyDoDungMay, SxMayHuIn, SxMayHuOut,
} from "../api/client";
import { NHAN_MUC_DO } from "../api/kyThuatMay";
import { ChonNgay } from "../components/ChonNgay";
import { NguoiLamChon, todayYmd, type NguoiLam } from "./ThsxExecPanels";
import { ThsxHop } from "./thsx/ThsxHop";

/** Năm lời gọi máy chủ của hộp — trang bàn tổ gắn token + tổ. */
export type DungMayExec = {
  ds: (nam: number, thang: number) => Promise<SxDungMayListOut>;
  bao: (body: SxDungMayIn) => Promise<SxDungMay>;
  sua: (id: number, body: SxDungMaySuaIn) => Promise<SxDungMay>;
  xoa: (id: number) => Promise<void>;
  mayHu: (body: SxMayHuIn) => Promise<SxMayHuOut>;
};

const LY_DO: { ma: SxLyDoDungMay; ten: string }[] = [
  { ma: "may_hu", ten: "Máy hư" },
  { ma: "het_hang", ten: "Hết hàng" },
];
// Mức độ: đọc thẳng `NHAN_MUC_DO` của module Sửa chữa máy, không khai lại chuỗi ở màn này.
const MUC_DO = Object.entries(NHAN_MUC_DO);
const MUC_DO_MAC_DINH = "trung_binh" in NHAN_MUC_DO ? "trung_binh" : (MUC_DO[0]?.[0] ?? "trung_binh");
const CHAM_MUC_DO: Record<string, string> = {
  nhe: "var(--tt-la-dot)", trung_binh: "var(--tt-vang-dot)", nghiem_trong: "var(--tt-do-dot)",
};

const ngayNgan = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
/** "2026-09" → "2026-10-01" — ngày sớm nhất còn báo được sau kỳ lương đã chốt muộn nhất. */
const dauThangSau = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
};
const loiCua = (e: unknown) => (e instanceof Error ? e.message : "Không lưu được, thử lại.");

/** Câu toast sau khi báo máy hư — nói đúng đã gửi mới, gắn vào cái đang mở, hay chỉ có phiếu sửa. */
function cauMayHu(r: SxMayHuOut): string {
  const dau = r.moi ? `Đã gửi ${r.yeu_cau_ma} tới tổ sửa chữa`
    : r.phieu_ma ? `Đã gắn vào phiếu sửa ${r.phieu_ma} đang mở`
      : `Đã gắn vào ${r.yeu_cau_ma} đang chờ tổ sửa chữa nhận`;
  const them = [
    r.tam_dung.length > 0 ? "việc trên máy đã tạm dừng" : null,
    r.dung_may ? `đã lưu ngày dừng ${ngayNgan(r.dung_may.ngay)}` : null,
  ].filter(Boolean);
  return `${dau}${them.length ? `, ${them.join(", ")}` : ""}.`;
}

export function BaoDungMayModal({
  tenTo, homNay = todayYmd(), exec, onDong, onBao,
}: {
  tenTo?: string;
  homNay?: string;
  exec: DungMayExec;
  onDong: () => void;
  /** Lưu / sửa / xoá xong — trang bắn toast câu này. */
  onBao: (cau: string) => void;
}) {
  const [ngay, setNgay] = useState(homNay);
  const [lyDo, setLyDo] = useState<SxLyDoDungMay | null>(null);
  const [suaChua, setSuaChua] = useState("");
  const [ghiChu, setGhiChu] = useState("");
  const [data, setData] = useState<SxDungMayListOut | null>(null);
  const [chon, setChon] = useState<Set<number>>(new Set());
  const [loi, setLoi] = useState<string | null>(null);
  const [dangGui, setDangGui] = useState(false);
  const [nap, setNap] = useState(0);
  // Dòng đang hỏi "Xoá hẳn?" ngay tại chỗ — xoá ngày dừng là đổi tiền lương của cả tổ.
  const [hoiXoa, setHoiXoa] = useState<number | null>(null);
  // Dòng đang sửa — null = đang báo ngày mới.
  const [dangSua, setDangSua] = useState<SxDungMay | null>(null);
  // Phần báo tổ sửa chữa (Máy hư hôm nay).
  const [mayId, setMayId] = useState<number | null>(null);
  const [mayDung, setMayDung] = useState(false);
  const [mucDo, setMucDo] = useState(MUC_DO_MAC_DINH);
  const [moTa, setMoTa] = useState("");
  const [tinhLuong, setTinhLuong] = useState(false);
  // Lần nạp đầu tick sẵn mọi người của tổ; nạp lại sau khi lưu / đổi tháng thì giữ người đang tick.
  const daTick = useRef(false);
  const idPhieu = useId();
  const idMoTa = useId();

  const nam = Number(ngay.slice(0, 4));
  const thang = Number(ngay.slice(5, 7));
  useEffect(() => {
    let huy = false;
    exec.ds(nam, thang).then((r) => {
      if (huy) return;
      setData(r);
      // Chỉ được báo hỏng: không chọn ngày / lý do, luôn là máy hư hôm nay (ngày xưởng).
      if (!r.quyen_luong) {
        setLyDo("may_hu");
        if (r.hom_nay) setNgay(r.hom_nay);
      }
      if (!daTick.current) {
        daTick.current = true;
        setChon(new Set(r.nguoi.map((n) => n.employee_id)));
      }
      // Máy chọn sẵn: máy đầu danh sách (máy đang chạy việc của tổ đứng đầu).
      setMayId((cu) => (cu != null && (r.may ?? []).some((m) => m.id === cu) ? cu : (r.may?.[0]?.id ?? null)));
    }).catch((e: unknown) => { if (!huy) setLoi(loiCua(e)); });
    return () => { huy = true; };
  }, [exec, nam, thang, nap]);

  const dsNguoi: NguoiLam[] = (data?.nguoi ?? []).map((n) => ({ id: n.employee_id, ten: n.ho_ten, the: [], mo: false }));
  const soNguoi = dsNguoi.filter((n) => chon.has(n.id)).length;
  // Kỳ lương đã chốt / đã chi khoá ngày thuộc kỳ (máy chủ chặn cùng luật, đây chỉ khoá trước cho rõ).
  const chot = new Set(data?.ky_da_chot ?? []);
  const thangKhoa = (iso: string) => chot.has(iso.slice(0, 7));
  const chotMuon = [...chot].sort().slice(-1)[0];
  const ngayDang = dangSua?.ngay ?? ngay;
  const khoa = thangKhoa(ngayDang);

  // Máy hư HÔM NAY (theo ngày xưởng máy chủ) ⇒ báo tổ sửa chữa; ngày đã qua thì chỉ còn phần lương.
  const homNayXuong = data?.hom_nay ?? homNay;
  const luongDuoc = data?.quyen_luong ?? false;
  const baoHong = (data?.quyen_bao_hong ?? false) && !dangSua && lyDo === "may_hu" && ngay === homNayXuong;
  const dsMay = data?.may ?? [];
  const may = dsMay.find((m) => m.id === mayId) ?? null;
  const daCoNgayNay = (data?.ds ?? []).some((d) => d.ngay === ngay);
  const coLuong = baoHong ? tinhLuong : true;
  const hopLe = baoHong
    ? may != null && (!tinhLuong || (soNguoi > 0 && !khoa && !daCoNgayNay))
    : !!ngay && lyDo != null && soNguoi > 0 && !khoa;

  function moSua(d: SxDungMay) {
    setLoi(null);
    setDangSua(d);
    setLyDo(d.ly_do);
    setSuaChua(d.sua_chua_id != null ? String(d.sua_chua_id) : "");
    setGhiChu(d.ghi_chu ?? "");
    setChon(new Set(d.nguoi.map((n) => n.employee_id)));
  }

  function thoiSua() {
    setDangSua(null);
    setLyDo(null);
    setSuaChua("");
    setGhiChu("");
    setChon(new Set(dsNguoi.map((n) => n.id)));
  }

  const nguoiIds = () => dsNguoi.filter((n) => chon.has(n.id)).map((n) => n.id);

  async function guiMayHu() {
    if (may == null) return;
    const r = await exec.mayHu({
      may_id: may.id, muc_do: mucDo, mo_ta: moTa.trim() || null, dung_san_xuat: mayDung,
      tinh_luong: tinhLuong, ghi_chu: tinhLuong ? (ghiChu.trim() || null) : null,
      nguoi_ids: tinhLuong ? nguoiIds() : [],
    });
    onBao(cauMayHu(r));
    onDong();
  }

  async function luu() {
    if (!hopLe || dangGui || lyDo == null) return;
    setDangGui(true);
    setLoi(null);
    try {
      if (baoHong) {
        await guiMayHu();
        return;
      }
      const body = {
        ly_do: lyDo,
        sua_chua_id: lyDo === "may_hu" && suaChua ? Number(suaChua) : null,
        ghi_chu: ghiChu.trim() || null,
        nguoi_ids: nguoiIds(),
      };
      if (dangSua) {
        await exec.sua(dangSua.id, body);
        onBao(`Đã sửa ngày dừng máy ${ngayNgan(dangSua.ngay)}.`);
        thoiSua();
      } else {
        await exec.bao({ ngay, ...body });
        onBao(`Đã báo dừng máy ngày ${ngayNgan(ngay)}.`);
        setGhiChu("");
        setSuaChua("");
      }
      setNap((n) => n + 1);
    } catch (e) {
      setLoi(loiCua(e));
    } finally {
      setDangGui(false);
    }
  }

  async function xoa(d: SxDungMay) {
    setLoi(null);
    setHoiXoa(null);
    try {
      await exec.xoa(d.id);
      onBao(`Đã xoá ngày dừng máy ${ngayNgan(d.ngay)}.`);
      if (dangSua?.id === d.id) thoiSua();
      setNap((n) => n + 1);
    } catch (e) {
      setLoi(loiCua(e));
    }
  }

  const nutChinh = baoHong ? (tinhLuong ? "Gửi tổ sửa chữa và lưu ngày dừng" : "Gửi tổ sửa chữa") : "Lưu";

  return (
    <ThsxHop tieuDe={dangSua ? `Sửa ngày dừng máy ${ngayNgan(dangSua.ngay)}` : "Báo dừng máy"} phuDe={tenTo}
      nutPhu="Đóng" nutChinh={nutChinh} nutChinhKhoa={!hopLe}
      dangGui={dangGui} loi={loi} phimTat={baoHong ? "Ctrl + Enter để gửi" : "Ctrl + Enter để lưu"}
      onPhimTat={luu} onDong={onDong} onChinh={luu}>
      {luongDuoc && (
        <div className="thsx-f">
          <span className="thsx-f__n">Ngày</span>
          {dangSua ? (
            <div className="thsx-dm-sua">
              <span className="thsx-num">{ngayNgan(dangSua.ngay)}</span>
              <button type="button" className="thsx-b-lk" onClick={thoiSua}>Thôi sửa, báo ngày khác</button>
            </div>
          ) : (
            <ChonNgay value={ngay} onChange={(v) => v && setNgay(v)} max={homNay}
              min={chotMuon ? dauThangSau(chotMuon) : undefined} required aria-label="Ngày dừng máy" />
          )}
        </div>
      )}

      {khoa && coLuong && (
        <div className="thsx-bao thsx-bao--vang">
          Kỳ lương tháng {ngayDang.slice(5, 7)}/{ngayDang.slice(0, 4)} đã chốt — ngày thuộc kỳ này không báo,
          sửa hay xoá được nữa.
        </div>
      )}

      {luongDuoc && (
        <div className="thsx-f">
          <span className="thsx-f__n">Lý do</span>
          <div className="thsx-seg" role="group" aria-label="Lý do">
            {LY_DO.map((l) => (
              <button key={l.ma} type="button" className="thsx-seg__btn" aria-pressed={lyDo === l.ma}
                onClick={() => setLyDo(l.ma)}>{l.ten}</button>
            ))}
          </div>
        </div>
      )}

      {baoHong && (
        <>
          <div className="thsx-f" role="radiogroup" aria-label="Máy hư">
            <span className="thsx-f__n">Máy hư</span>
            {dsMay.length === 0 ? (
              <div className="thsx-bao thsx-bao--vang">
                Tổ chưa có máy nào. Khai "Tổ đứng máy" ở danh mục Máy{luongDuoc ? ", hoặc chọn ngày đã qua để chỉ tính ngày dừng" : ""}.
              </div>
            ) : (
              <div className="thsx-hop-ds">
                {dsMay.map((m) => (
                  <label key={m.id} className="thsx-hop-ds__o">
                    <input type="radio" name="may-hu" checked={mayId === m.id} onChange={() => setMayId(m.id)}
                      aria-label={`${m.ma} ${m.ten}`} />
                    <span>
                      {m.ma} {m.ten}
                      <small>{m.viec ? `${m.viec_dang_chay ? "Đang chạy" : "Tạm dừng"} ${m.viec}` : "Rảnh"}</small>
                      {m.dang_mo && <small>Đã báo {m.dang_mo}, gửi nữa sẽ gắn vào đây</small>}
                    </span>
                    <span />
                  </label>
                ))}
              </div>
            )}
          </div>

          <label className={`thsx-tick${mayDung ? " is-do" : ""}`}>
            <input type="checkbox" checked={mayDung} onChange={(e) => setMayDung(e.target.checked)} />
            <span>
              <span className="thsx-tick__ten">
                Máy đang dừng, không chạy được
                {mayDung && (
                  <span className="thsx-tick__the">
                    {may?.viec_dang_chay ? "Ưu tiên cao và tạm dừng việc" : "Ưu tiên cao"}
                  </span>
                )}
              </span>
              <span className="thsx-tick__mo">
                {may?.viec_dang_chay
                  ? `Việc ${may.viec} sẽ tạm dừng, giờ máy ngừng tính từ lúc gửi.`
                  : "Yêu cầu lên đầu hàng chờ của tổ sửa chữa."}
              </span>
            </span>
          </label>

          <div className="thsx-f">
            <span className="thsx-f__n">Mức độ theo bạn thấy</span>
            <div className="thsx-chips" role="group" aria-label="Mức độ">
              {MUC_DO.map(([ma, nhan]) => (
                <button key={ma} type="button" className="thsx-chip" aria-pressed={mucDo === ma}
                  onClick={() => setMucDo(ma)}>
                  <span className="thsx-chip__cham" style={{ background: CHAM_MUC_DO[ma] ?? "var(--ash-2)" }} />
                  {nhan}
                </button>
              ))}
            </div>
            <span className="thsx-f__g">Tổ sửa chữa sẽ đánh giá lại khi nhận.</span>
          </div>

          <div className="thsx-f">
            <label className="thsx-f__n" htmlFor={idMoTa}>Triệu chứng</label>
            <textarea id={idMoTa} className="thsx-x-in thsx-hop-ta thsx-hop-ta--thap" value={moTa}
              placeholder="Kể đúng cái mình thấy, ví dụ máy kêu to ở tốc độ cao"
              onChange={(e) => setMoTa(e.target.value)} />
          </div>
        </>
      )}

      {!baoHong && lyDo === "may_hu" && (
        <div className="thsx-f">
          <label className="thsx-f__n" htmlFor={idPhieu}>Phiếu sửa máy</label>
          <select id={idPhieu} className="thsx-x-in" value={suaChua} onChange={(e) => setSuaChua(e.target.value)}>
            <option value="">Không gắn phiếu</option>
            {(data?.phieu_sua ?? []).map((p) => (
              <option key={p.id} value={p.id}>{[p.ma, p.may_ten].filter(Boolean).join(" ")}</option>
            ))}
          </select>
          <span className="thsx-f__g">Phiếu sửa báo trong tháng của máy tổ đã chạy việc; không có thì bỏ trống.</span>
        </div>
      )}

      <div className={baoHong ? "thsx-dm-khoi" : "thsx-dm-khoi thsx-dm-khoi--tron"}>
        {baoHong && luongDuoc && (
          <label className={`thsx-tick${tinhLuong ? " is-xanh" : ""}`}>
            <input type="checkbox" checked={tinhLuong} disabled={daCoNgayNay}
              onChange={(e) => setTinhLuong(e.target.checked)} />
            <span>
              <span className="thsx-tick__ten">Tính ngày dừng cho lương</span>
              <span className="thsx-tick__mo">
                {daCoNgayNay
                  ? `Tổ đã báo dừng máy ngày ${ngayNgan(ngay)}, sửa ở bảng dưới nếu cần.`
                  : `Ngày ${ngayNgan(ngay)} tổ ăn trọn chỉ tiêu ngày, cộng thêm tiền các lần ghi trong ngày nếu có.`}
              </span>
            </span>
          </label>
        )}

        {coLuong && (
          <>
            <label className="thsx-f">
              <span className="thsx-f__n">Ghi chú</span>
              <input className="thsx-x-in" value={ghiChu} placeholder="Không bắt buộc" onChange={(e) => setGhiChu(e.target.value)} />
            </label>

            <NguoiLamChon ds={dsNguoi} chon={chon} onDoi={setChon} tieuDe="Người hưởng"
              cauThieu="Chọn ít nhất một người hưởng ngày dừng máy." />

            {!baoHong && (
              <div className="thsx-bao thsx-bao--xam">
                Ngày này tổ ăn chỉ tiêu ngày, cộng thêm tiền các lần ghi trong ngày nếu có. Chia cho người hưởng theo
                tỷ lệ lương ca máy.
              </div>
            )}
          </>
        )}
      </div>

      {data && data.ds.length > 0 && (
        <div className="thsx-f">
          <span className="thsx-f__n">Đã báo tháng {String(thang).padStart(2, "0")}/{nam}</span>
          <table className="thsx-dm-ds">
            <tbody>
              {data.ds.map((d) => (
                <tr key={d.id} aria-current={dangSua?.id === d.id || undefined}>
                  <td className="thsx-num">{ngayNgan(d.ngay)}</td>
                  <td>{d.ly_do_ten}</td>
                  <td>{d.sua_chua_ma ?? d.yeu_cau_ma ?? ""}</td>
                  <td className="thsx-num">{d.nguoi.length} người</td>
                  <td className="thsx-dm-ds__nut">
                    {thangKhoa(d.ngay) ? (
                      <span className="thsx-f__g">Kỳ đã chốt</span>
                    ) : hoiXoa === d.id ? (
                      <>
                        <span className="thsx-f__g">Xoá hẳn ngày {ngayNgan(d.ngay)}?</span>
                        <button type="button" className="thsx-b-lk" onClick={() => xoa(d)}>Xoá</button>
                        <button type="button" className="thsx-b-lk" onClick={() => setHoiXoa(null)}>Thôi</button>
                      </>
                    ) : (
                      <>
                        <button type="button" className="thsx-b-lk" aria-label={`Sửa ngày ${ngayNgan(d.ngay)}`}
                          onClick={() => moSua(d)}>Sửa</button>
                        <button type="button" className="thsx-b-lk" aria-label={`Xoá ngày ${ngayNgan(d.ngay)}`}
                          onClick={() => setHoiXoa(d.id)}>Xoá</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ThsxHop>
  );
}
