// VIEW "DANH SÁCH BẢN GHI" của bàn tổ — lưới PHẲNG một dòng một việc (09/10/2026, mockup
// `ban-to-ngan-A-tinh-chinh.html`), theo khuôn lưới kiểu bảng tính (components/LuoiDs). Đầu trang, ô
// tìm, bộ lọc, nút "Cột" do `ThucHienSxPage` giữ; ở đây chỉ nhận cột đang ẩn / thứ tự cột từ trang.
//
// Trước 09/10 mỗi LỆNH là một khối gấp/mở có dải routing to ở trên. Giờ lệnh thành cột: mã + ngày
// tạo + ngày tổ nhận ở cột Lệnh, tên + khách ở cột Sản phẩm, và chuỗi công đoạn thu thành dải tuyến
// nhỏ ở cột "Hàng đang tới đâu" (rê chuột lên chấm đọc số liệu từng bước như dải to cũ). Máy chủ vẫn
// cắt trang theo LỆNH — một lệnh không bị xé qua hai trang.
import { Icon } from "../components/Icons";
import type { SxChoXacNhanBanGiao, SxLenhNhom, SxWorkItem } from "../api/client";
import { ChipKcs, ChipKhuon, ChipLoaiBuoc } from "../components/ChipBuoc";
import {
  ChipTT, CuonLuoi, rongLuoi, soCotGhim, xepCot, apLuoi, type CauHinhLuoi, type CotLuoi, type MauTT,
} from "../components/LuoiDs";
import { gioNgan, num, ngayGio, thoiLuong } from "./keHoachSxShared";
import { ngayGioDayDu, ngayNgan } from "./loc-san-xuat/ngay";
import { nhanChang, nhanDonVi } from "./lsxBuoc";
import { TheGap } from "./lsxKhau";
import { ChamCho, type SxChoCuaViec } from "./thsxChoXacNhan";
import { slTot, sxNguonIcon, tienDoThucTe } from "./thsxShared";
import { cauViTri, daiCuaViec, viTriHang } from "./thsxTuyen";
import { ThsxTuyenNho } from "./ThsxTuyenNho";
import "./lenh-sx-chung.css"; // thẻ GẤP (`lsc-gap`) của lsxKhau

interface CotThsx extends CotLuoi { w?: number; n?: boolean }

/** Cột lưới của bàn tổ, đúng thứ tự mockup. Khoá giữ tên cũ khi cùng nghĩa để cấu hình lưới đã lưu
 *  (ẩn / thứ tự / độ rộng) không vỡ. Lệnh + Sản phẩm là coDinh nên luôn ghim trái khi cuộn ngang.
 *  Ô Công đoạn mang chấm chờ xác nhận + chip KCS / loại bước / khuôn — ẩn cột là mất các tín hiệu
 *  đó trên dòng, nên mặc định hiện. */
export const COT_THSX: CotThsx[] = [
  { key: "ma", label: "Lệnh", coDinh: true, w: 150 },
  { key: "sp", label: "Sản phẩm", coDinh: true, w: 200 },
  { key: "cd", label: "Công đoạn", w: 230 },
  { key: "tt", label: "Trạng thái", w: 190 },
  { key: "sl", label: "Tốt / cần", w: 150, n: true },
  { key: "tuyen", label: "Hàng đang tới đâu", w: 260 },
  { key: "may", label: "Máy và thời gian", w: 190 },
  { key: "qc", label: "Quy cách", w: 290 },
  { key: "vt", label: "Định mức vật tư", w: 220 },
];

/** Cùng sắc với chip đếm ở thanh lọc của bàn (chờ làm xanh dương, đang chạy xanh lá, tạm dừng vàng,
 *  hoàn thành xám) — mỗi trạng thái một sắc. */
export const MAU_TT: Record<string, MauTT> = {
  released: "xanh",
  running: "la",
  paused: "vang",
  completed: "slate",
};
export const NHAN_TT: Record<string, string> = {
  released: "Chờ làm",
  running: "Đang chạy",
  paused: "Tạm dừng",
  completed: "Hoàn thành",
};

interface Props {
  /** MỘT TRANG lệnh/bài ghép (máy chủ đã cắt, đếm theo lệnh); lưới trải phẳng mọi việc của trang. */
  lenh: SxLenhNhom[];
  selectedId: number | null;
  onPick: (w: SxWorkItem) => void;
  /** Việc chờ tổ bấm theo công đoạn (§11.5) — chấm đỏ trên dòng công đoạn. */
  cho?: ReadonlyMap<number, SxChoCuaViec>;
  /** Cột đang ẩn + thứ tự cột người xem đã kéo (do trang cha giữ cùng nút "Cột"). */
  cotAn?: ReadonlySet<string>;
  thuTu?: string[];
  /** Cấu hình lưới của màn cha — có thì ghim + kéo độ rộng được. */
  luoi?: CauHinhLuoi;
}

/** Quy cách in: mỗi mẩu một thẻ nhỏ, không nối bằng dấu. Rỗng thì trả mảng rỗng. */
function mauQuyCach(qc: SxWorkItem["quy_cach"]): string[] {
  if (!qc) return [];
  const parts: string[] = [];
  if (qc.giay) parts.push(`${qc.giay}${qc.dinh_luong ? ` ${qc.dinh_luong}gsm` : ""}`);
  else if (qc.dinh_luong) parts.push(`${qc.dinh_luong}gsm`);
  if (qc.kho_in) parts.push(`Khổ ${qc.kho_in}`);
  if (qc.so_mau != null) parts.push(`${qc.so_mat ? `${qc.so_mat} mặt ` : ""}${qc.so_mau} màu`);
  if (qc.so_kem != null && qc.so_kem > 0) parts.push(`${qc.so_kem} kẽm`);
  return parts;
}

/** Thời gian làm dự kiến của bước (mất bao lâu để xong) — không phải một mốc ngày giờ. */
function phutChayGon(w: SxWorkItem): { main: string; sub?: string } | null {
  if (w.chay_phut == null || w.chay_phut <= 0) return null;
  const giua = Math.round(w.chay_phut);
  const lo = w.chay_phut_min == null ? giua : Math.round(w.chay_phut_min);
  const hi = w.chay_phut_max == null ? giua : Math.round(w.chay_phut_max);
  const sub = lo !== giua || hi !== giua
    ? `Nhanh nhất ${thoiLuong(lo)}\nChậm nhất ${thoiLuong(hi)}` : undefined;
  return { main: thoiLuong(giua), sub };
}

/** Mốc trong ngày hôm nay chỉ cần giờ; ngày khác thì kèm ngày, kẻo "từ 11:41" của hôm qua đọc
 *  thành hôm nay. */
function moc(v: string): string {
  const d = new Date(v);
  return d.toDateString() === new Date().toDateString() ? gioNgan(v) : ngayNgan(v, true);
}

/** Dòng phụ cột Trạng thái: đang chạy từ lúc nào và ai; dừng từ lúc nào; xong lúc nào; chưa chạy
 *  thì đã giao ai chưa. */
/** Chip cam "Hàng chờ nhận" + bao nhiêu, từ bước nào. Nhiều lần giao chờ thì cộng theo đơn vị và
 *  ghi số lần; tên bước chỉ ghi khi mọi lần cùng một bước. */
function HangChoNhan({ hang }: { hang: SxChoXacNhanBanGiao[] }) {
  const theoDv = new Map<string, number>();
  for (const b of hang) theoDv.set(b.don_vi, (theoDv.get(b.don_vi) ?? 0) + b.so_luong);
  const buoc = new Set(hang.map((b) => b.nguon_ten));
  return (
    <span className="thsx-hang-cho">
      <ChipTT mau="cam">Hàng chờ nhận</ChipTT>
      {[...theoDv].map(([dv, so]) => (
        <span key={dv} className="thsx-l2 thsx-num">{num(so)}{dv ? ` ${nhanChang(dv)}` : ""}</span>
      ))}
      {buoc.size === 1
        ? <span className="thsx-l2">từ {hang[0].nguon_ten}</span>
        : <span className="thsx-l2">{hang.length} lần giao</span>}
    </span>
  );
}

/** "A", "A và B", "A và 2 người nữa" — không nối tên bằng dấu phẩy (#68). */
export function noiTen(ds: string[]): string {
  if (ds.length <= 2) return ds.join(" và ");
  return `${ds[0]} và ${ds.length - 1} người nữa`;
}

export function dongPhuTrangThai(w: SxWorkItem): string {
  const ten = noiTen(w.nguoi_lam ?? []);
  const phien = w.thuc_te ?? [];
  const cuoi = phien[phien.length - 1];
  if (w.trang_thai === "running") {
    const mo = phien.find((p) => p.ket_thuc == null) ?? cuoi;
    return [mo ? `từ ${moc(mo.bat_dau)}` : "", ten].filter(Boolean).join(" ");
  }
  if (w.trang_thai === "paused") {
    return [cuoi?.ket_thuc ? `dừng từ ${moc(cuoi.ket_thuc)}` : "", ten].filter(Boolean).join(" ");
  }
  if (w.trang_thai === "completed") return cuoi?.ket_thuc ? `xong ${ngayNgan(cuoi.ket_thuc, true)}` : "";
  return ten ? `đã giao ${ten}` : "chưa giao thợ";
}

export function ThsxDanhSach({
  lenh, selectedId, onPick, cho, cotAn, thuTu, luoi,
}: Props) {
  const cot = apLuoi(luoi, xepCot(COT_THSX, thuTu ?? []).filter((c) => !cotAn?.has(c.key)));
  const dong = lenh.flatMap((l) => l.cong_viec.map((w) => ({ l, w })));
  if (dong.length === 0) {
    return <p className="thsx-note">Tổ chưa có lệnh nào được phát hành.</p>;
  }
  return (
    <div className="thsx-ds__scroll">
      <div className="lds-sheet thsx-lds-sheet">
        <CuonLuoi ghim={soCotGhim(cot, luoi?.ghim)}>
          <table className="lds-g thsx-g2" style={{ minWidth: rongLuoi(cot) }}>
            <colgroup>
              {cot.map((c) => <col key={c.key} style={c.w ? { width: c.w } : undefined} />)}
            </colgroup>
            <thead>
              <tr>
                {cot.map((c) => <th key={c.key} className={c.n ? "n" : undefined}>{c.label}{luoi?.keo(c.key)}</th>)}
              </tr>
            </thead>
            <tbody>
              {dong.map(({ l, w }) => {
                const chon = w.id === selectedId;
                const mo = () => onPick(w);
                return (
                  <tr
                    key={w.id}
                    className={`lds-dong${chon ? " is-chon" : ""}`}
                    tabIndex={0}
                    aria-current={chon ? "true" : undefined}
                    onClick={mo}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); mo(); } }}
                  >
                    {cot.map((c) => <OThsx key={c.key} cot={c.key} l={l} w={w} cho={cho?.get(w.id)} />)}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CuonLuoi>
      </div>
    </div>
  );
}

function OThsx({ cot, l, w, cho }: { cot: string; l: SxLenhNhom; w: SxWorkItem; cho?: SxChoCuaViec }) {
  switch (cot) {
    case "ma": {
      const nhan = w.nhan_luc ?? l.nhan_luc;
      return (
        <td title={[
          l.tao_luc ? `Ngày tạo lệnh ${ngayGioDayDu(l.tao_luc) ?? ""}` : "",
          nhan ? `Tổ nhận việc ${ngayGio(nhan)}` : "",
        ].filter(Boolean).join("\n") || undefined}>
          <span className="thsx-g2__ma">
            <Icon name={sxNguonIcon(w.nguon_loai)} size={13} className="thsx-lds-ic" />
            <span className="thsx-num">{w.nguon_ma?.trim() || "—"}</span>
            {l.is_rush && <TheGap />}
          </span>
          <span className="thsx-l2 thsx-num">
            {l.tao_luc && <span>Tạo {ngayNgan(l.tao_luc)}</span>}
            {nhan && <span>Nhận {ngayNgan(nhan, true)}</span>}
          </span>
        </td>
      );
    }
    case "sp":
      return (
        <td title={[w.nguon_ten, w.khach_hang ? `Khách hàng: ${w.khach_hang}` : ""].filter(Boolean).join("\n") || undefined}>
          <span className="thsx-g2__ten">{w.nguon_ten || "—"}</span>
          {w.khach_hang && <span className="thsx-l2">{w.khach_hang}</span>}
        </td>
      );
    case "cd":
      return (
        <td title={w.ten_cong_doan || undefined}>
          <span className="thsx-g2__ten">
            {w.ten_cong_doan || "—"}
            {/* Hàng chờ nhận đã nói ở ô Trạng thái — chấm ở đây chỉ còn cho lỗi KCS. */}
            <ChamCho c={cho && { ...cho, nhan: 0 }} />
          </span>
          <span className="thsx-lds-chips thsx-g2__chips">
            <ChipLoaiBuoc loai_buoc={w.loai_buoc} nha_cung_cap={w.nha_cung_cap} />
            {w.la_kcs_cuoi && <span className="thsx-g2__kcs">KCS cuối</span>}
            <ChipKcs so_lan={w.kcs_so_lan} loi={w.kcs_loi} />
            <ChipKhuon can_khuon={!!w.khuon} khuon={{ ...(w.khuon ?? {}), da_nhan: w.khuon_da_nhan }} />
          </span>
        </td>
      );
    case "tt": {
      const phu = dongPhuTrangThai(w);
      return (
        <td title={phu || undefined}>
          <ChipTT mau={MAU_TT[w.trang_thai] ?? "xanh"}>{NHAN_TT[w.trang_thai] ?? NHAN_TT.released}</ChipTT>
          {phu && <span className="thsx-l2">{phu}</span>}
          {/* Hàng bước trước đã giao tới mà tổ mình chưa bấm nhận (10/10/2026) — nói bằng chữ ngay ô
              Trạng thái thay cho chấm đỏ không chữ ở cột Công đoạn. Không so kế hoạch: hao hụt luôn có. */}
          {(cho?.hang?.length ?? 0) > 0 && <HangChoNhan hang={cho!.hang!} />}
        </td>
      );
    }
    case "sl": {
      const can = w.muc_tieu ?? w.so_luong_ra;
      const dv = nhanDonVi(w.don_vi_ra || (w.ngoai_dong ? w.don_vi_vao : null) || "");
      const td = tienDoThucTe(w);
      const pct = td ? td.pct : can ? Math.min(100, Math.round(((w.da_lam ?? 0) / can) * 100)) : null;
      return (
        <td className="n">
          <span>{can != null ? num(w.da_lam ?? 0) : slTot(w)}</span>
          {can != null && <span className="thsx-g2__can"> / {num(can)}{dv ? ` ${dv}` : ""}</span>}
          {pct != null && <span className="thsx-g2__pb" aria-hidden="true"><i style={{ width: `${pct}%` }} /></span>}
        </td>
      );
    }
    case "tuyen": {
      const dai = daiCuaViec(l, w);
      const v = viTriHang(dai, w.id, w.step_key);
      if (!v) return <td className="lds-mu3">—</td>;
      return (
        <td>
          <ThsxTuyenNho dai={dai} congViecId={w.id} stepKey={w.step_key} />
          <span className={`thsx-l2 thsx-cau--${v.k}`}>{cauViTri(v, dai, true)}</span>
        </td>
      );
    }
    case "may": {
      const d = phutChayGon(w);
      if (!w.may && !d) return <td className="lds-mu3">—</td>;
      return (
        <td title={[w.may, d?.sub].filter(Boolean).join("\n") || undefined}>
          <span className="thsx-g2__ten">{w.may || "—"}</span>
          {d && <span className="thsx-l2">dự kiến {d.main}</span>}
        </td>
      );
    }
    case "qc": {
      const mau = mauQuyCach(w.quy_cach);
      if (mau.length === 0) return <td className="lds-mu3">—</td>;
      return (
        <td title={mau.join("\n")}>
          {mau.map((m, i) => (
            <span key={m} className="lds-tag" style={i === 0 ? { marginLeft: 0 } : undefined}>{m}</span>
          ))}
        </td>
      );
    }
    case "vt": {
      const vt = w.dinh_muc_vat_tu;
      if (!vt || vt.length === 0) return <td className="lds-mu3">—</td>;
      const v = vt[0];
      const ten = (v.ten || "").trim() || "—";
      const rest = vt.length - 1;
      return (
        <td title={vt.map((x) => `${x.ten || ""} ${num(x.so_luong)}${x.don_vi ? ` ${nhanDonVi(x.don_vi)}` : ""}`).join("\n")}>
          <span className="thsx-g2__ten">
            {ten}
            {v.so_luong != null && (
              <span className="lds-u">{num(v.so_luong)}{v.don_vi ? ` ${nhanDonVi(v.don_vi)}` : ""}</span>
            )}
          </span>
          {rest > 0 && <span className="thsx-l2">+{rest} khác</span>}
        </td>
      );
    }
    default:
      return <td />;
  }
}
