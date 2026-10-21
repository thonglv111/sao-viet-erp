// Hộp BÁO DỪNG MÁY ở bàn tổ (Đợt 2 công thức khoán, 21/10/2026, mockup `khoan-cong-thuc-bo-sung.html`
// màn 4). Ngày máy hư / hết hàng tổ ăn chỉ tiêu ngày, chia cho người hưởng theo lương ca máy — người
// hưởng do tổ trưởng tick, tick sẵn cả tổ. Một tổ một ngày một lần: báo trùng máy chủ trả câu lỗi.
// Tick nhầm thì bấm Sửa ở dòng đã báo — hộp mở lại giá trị cũ, sửa tại chỗ (ngày giữ nguyên).
import { useEffect, useId, useRef, useState } from "react";

import type { SxDungMay, SxDungMayIn, SxDungMayListOut, SxDungMaySuaIn, SxLyDoDungMay } from "../api/client";
import { ChonNgay } from "../components/ChonNgay";
import { NguoiLamChon, todayYmd, type NguoiLam } from "./ThsxExecPanels";
import { ThsxHop } from "./thsx/ThsxHop";

/** Bốn lời gọi máy chủ của hộp — trang bàn tổ gắn token + tổ. */
export type DungMayExec = {
  ds: (nam: number, thang: number) => Promise<SxDungMayListOut>;
  bao: (body: SxDungMayIn) => Promise<SxDungMay>;
  sua: (id: number, body: SxDungMaySuaIn) => Promise<SxDungMay>;
  xoa: (id: number) => Promise<void>;
};

const LY_DO: { ma: SxLyDoDungMay; ten: string }[] = [
  { ma: "may_hu", ten: "Máy hư" },
  { ma: "het_hang", ten: "Hết hàng" },
];

const ngayNgan = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
/** "2026-09" → "2026-10-01" — ngày sớm nhất còn báo được sau kỳ lương đã chốt muộn nhất. */
const dauThangSau = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
};
const loiCua = (e: unknown) => (e instanceof Error ? e.message : "Không lưu được, thử lại.");

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
  // Dòng đang sửa — null = đang báo ngày mới.
  const [dangSua, setDangSua] = useState<SxDungMay | null>(null);
  // Lần nạp đầu tick sẵn mọi người của tổ; nạp lại sau khi lưu / đổi tháng thì giữ người đang tick.
  const daTick = useRef(false);
  const idPhieu = useId();

  const nam = Number(ngay.slice(0, 4));
  const thang = Number(ngay.slice(5, 7));
  useEffect(() => {
    let huy = false;
    exec.ds(nam, thang).then((r) => {
      if (huy) return;
      setData(r);
      if (!daTick.current) {
        daTick.current = true;
        setChon(new Set(r.nguoi.map((n) => n.employee_id)));
      }
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
  const hopLe = !!ngay && lyDo != null && soNguoi > 0 && !khoa;

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

  async function luu() {
    if (!hopLe || dangGui || lyDo == null) return;
    setDangGui(true);
    setLoi(null);
    const body = {
      ly_do: lyDo,
      sua_chua_id: lyDo === "may_hu" && suaChua ? Number(suaChua) : null,
      ghi_chu: ghiChu.trim() || null,
      nguoi_ids: dsNguoi.filter((n) => chon.has(n.id)).map((n) => n.id),
    };
    try {
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
    try {
      await exec.xoa(d.id);
      onBao(`Đã xoá ngày dừng máy ${ngayNgan(d.ngay)}.`);
      if (dangSua?.id === d.id) thoiSua();
      setNap((n) => n + 1);
    } catch (e) {
      setLoi(loiCua(e));
    }
  }

  return (
    <ThsxHop tieuDe={dangSua ? `Sửa ngày dừng máy ${ngayNgan(dangSua.ngay)}` : "Báo dừng máy"} phuDe={tenTo}
      nutPhu="Đóng" nutChinh="Lưu" nutChinhKhoa={!hopLe}
      dangGui={dangGui} loi={loi} phimTat="Ctrl + Enter để lưu" onPhimTat={luu} onDong={onDong} onChinh={luu}>
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

      {khoa && (
        <div className="thsx-bao thsx-bao--vang">
          Kỳ lương tháng {ngayDang.slice(5, 7)}/{ngayDang.slice(0, 4)} đã chốt — ngày thuộc kỳ này không báo,
          sửa hay xoá được nữa.
        </div>
      )}

      <div className="thsx-f">
        <span className="thsx-f__n">Lý do</span>
        <div className="thsx-seg" role="group" aria-label="Lý do">
          {LY_DO.map((l) => (
            <button key={l.ma} type="button" className="thsx-seg__btn" aria-pressed={lyDo === l.ma}
              onClick={() => setLyDo(l.ma)}>{l.ten}</button>
          ))}
        </div>
      </div>

      {lyDo === "may_hu" && (
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

      <label className="thsx-f">
        <span className="thsx-f__n">Ghi chú</span>
        <input className="thsx-x-in" value={ghiChu} placeholder="Không bắt buộc" onChange={(e) => setGhiChu(e.target.value)} />
      </label>

      <NguoiLamChon ds={dsNguoi} chon={chon} onDoi={setChon} tieuDe="Người hưởng"
        cauThieu="Chọn ít nhất một người hưởng ngày dừng máy." />

      <div className="thsx-bao thsx-bao--xam">
        Ngày này tổ ăn chỉ tiêu ngày, cộng thêm tiền các lần ghi trong ngày nếu có. Chia cho người hưởng theo
        tỷ lệ lương ca máy.
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
                  <td>{d.sua_chua_ma ?? ""}</td>
                  <td className="thsx-num">{d.nguoi.length} người</td>
                  <td className="thsx-dm-ds__nut">
                    {thangKhoa(d.ngay) ? (
                      <span className="thsx-f__g">Kỳ đã chốt</span>
                    ) : (
                      <>
                        <button type="button" className="thsx-b-lk" aria-label={`Sửa ngày ${ngayNgan(d.ngay)}`}
                          onClick={() => moSua(d)}>Sửa</button>
                        <button type="button" className="thsx-b-lk" aria-label={`Xoá ngày ${ngayNgan(d.ngay)}`}
                          onClick={() => xoa(d)}>Xoá</button>
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
