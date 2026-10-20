/** Tab LỊCH SỬ của ngăn công nợ (phương án 2): dòng thời gian mới nhất ở trên, mọi chứng từ từng
 *  có với đối tác này (hoá đơn / đợt giao, lần thu / lần trả, hoàn tiền) cộng việc "tới hạn mà chưa
 *  thu đủ" của các khoản đang trễ.
 *
 *  Chứng từ lấy từ CHÍNH sổ chi tiết của tab Sao kê, mở hết từ đầu tới hôm nay — một nguồn, nên dòng
 *  thời gian không bao giờ lệch bảng sao kê. Danh sách dài thì hiện dần, mỗi lần một trang.
 */
import { AlertTriangle, Banknote, FileText, PackageCheck, Undo2 } from "lucide-react";
import { useMemo, useState } from "react";

import type { SoChiTietDong } from "../../../api/client";
import { congNgay } from "../../../utils/ky";
import { Cum, TheNho } from "./Cum";
import { tien, vietSo } from "./dinhDang";
import { TabLichSu, type ViecLs } from "./TabLichSu";
import { chieuCongNo, useSoCongNo, type BenCongNo } from "./TabSaoKe";

/** Một khoản đang trễ hạn (hoá đơn / đợt giao còn nợ). */
export type KhoanTre = { khoa: string; ten: string; han: string; conNo: number; soNgayTre: number };

/** Ngày đầu của "mọi thời gian" — trước mọi chứng từ có thể có trong hệ. */
const TU_DAU = "2000-01-01";
const MOI_TRANG = 30;

function viecCuaDong(ben: BenCongNo, d: SoChiTietDong, i: number, onMoPhieu?: (code: string) => void): ViecLs {
  const s = chieuCongNo(ben, d);
  const phieu = (
    <Cum>
      {onMoPhieu ? (
        <button type="button" className="kt-lk" onClick={() => onMoPhieu(d.so_ct)}>{d.so_ct}</button>
      ) : (
        <TheNho>{d.so_ct}</TheNho>
      )}
      <span>{d.dien_giai}</span>
    </Cum>
  );
  const goc = { khoa: `ct-${i}`, moc: d.ngay };
  switch (d.loai) {
    case "hoa_don":
      return { ...goc, loai: "khac", icon: <FileText size={14} aria-hidden="true" />, ten: `Xuất hoá đơn ${d.so_ct}`,
        chiTiet: <span>{tien(s.tang)}</span> };
    case "dot_giao":
      return { ...goc, loai: "khac", icon: <PackageCheck size={14} aria-hidden="true" />, ten: `Nhận hàng ${d.so_ct}`,
        chiTiet: <span>{tien(s.tang)}</span> };
    case "phieu_thu":
      return { ...goc, loai: "lap", icon: <Banknote size={14} aria-hidden="true" />, ten: `Thu ${tien(s.giam)}`, chiTiet: phieu };
    case "phieu_chi":
      return { ...goc, loai: "lap", icon: <Banknote size={14} aria-hidden="true" />, ten: `Trả ${tien(s.giam)}`, chiTiet: phieu };
    case "hoan_tien_khach":
      // Trả lại tiền cho khách: phần khách đã đưa trước giảm đi, tức số khách nợ TĂNG lại.
      return { ...goc, loai: "khac", icon: <Undo2 size={14} aria-hidden="true" />, ten: `Trả lại khách ${tien(s.tang)}`,
        chiTiet: <Cum><TheNho>{d.so_ct}</TheNho><span>{d.dien_giai}</span></Cum> };
    default:
      // Nhà cung cấp hoàn tiền: nợ của mình TĂNG lại (tiền về két nhưng phần đã trả bị trừ đi).
      return { ...goc, loai: "khac", icon: <Undo2 size={14} aria-hidden="true" />, ten: `Nhà cung cấp hoàn ${tien(s.tang)}`,
        chiTiet: <Cum><TheNho>{d.so_ct}</TheNho><span>{d.dien_giai}</span></Cum> };
  }
}

export function LichSuCongNo({
  ben,
  id,
  homNay,
  tre,
  chuTre,
  lan = 0,
  onMoPhieu,
}: {
  ben: BenCongNo;
  id: number;
  /** Ngày máy chủ tính nợ — mốc cuối của dòng thời gian. */
  homNay: string;
  /** Các khoản đang trễ, mỗi khoản thêm một việc vào NGÀY ĐẦU TIÊN bị trễ (hạn + 1). */
  tre: KhoanTre[];
  /** "chưa thu đủ" / "chưa trả đủ". */
  chuTre: string;
  lan?: number;
  /** Chỉ phiếu của chính màn (phiếu thu bên phải thu, phiếu chi bên phải trả) mới mở được. */
  onMoPhieu?: (code: string) => void;
}) {
  const ky = useMemo(() => ({ tu: TU_DAU, den: homNay }), [homNay]);
  const { so, loi, dangTai } = useSoCongNo(ben, id, ky, lan);
  const [soHien, setSoHien] = useState(MOI_TRANG);
  const loaiPhieu = ben === "receivables" ? "phieu_thu" : "phieu_chi";

  const viec = useMemo(() => {
    if (!so) return [];
    const ds: { sx: string; v: ViecLs }[] = so.dong.map((d, i) => ({
      // Sổ đã xếp theo ngày rồi giờ ghi nhận; giữ đúng thứ tự đó trong cùng một ngày.
      sx: `${d.ngay}|${String(i).padStart(6, "0")}`,
      v: viecCuaDong(ben, d, i, d.loai === loaiPhieu ? onMoPhieu : undefined),
    }));
    for (const k of tre) {
      const moc = congNgay(k.han, 1);
      ds.push({
        sx: `${moc}|999999`,
        v: {
          khoa: `tre-${k.khoa}`,
          moc,
          loai: "huy",
          icon: <AlertTriangle size={14} aria-hidden="true" />,
          ten: `${k.ten} quá hạn ${chuTre}`,
          chiTiet: (
            <Cum>
              <span>{`Còn ${vietSo(k.conNo)}`}</span>
              <TheNho>{`Trễ ${vietSo(k.soNgayTre)} ngày`}</TheNho>
            </Cum>
          ),
        },
      });
    }
    return ds.sort((a, b) => (a.sx < b.sx ? 1 : a.sx > b.sx ? -1 : 0)).map((x) => x.v);
  }, [so, tre, ben, loaiPhieu, onMoPhieu, chuTre]);

  if (loi) return <p className="kt-do" role="alert">{loi}</p>;
  if (!so) return dangTai ? <p className="kt-mo">Đang tải lịch sử…</p> : null;
  if (viec.length === 0) return <p className="kt-mo">Chưa có chứng từ nào với đối tác này.</p>;
  return (
    <>
      <TabLichSu viec={viec.slice(0, soHien)} />
      {viec.length > soHien && (
        <div className="kt-hang-loc">
          <span className="kt-mo">{`Hiện ${vietSo(soHien)} trên ${vietSo(viec.length)} việc`}</span>
          <button type="button" className="kt-btn kt-btn--nho" onClick={() => setSoHien((n) => n + MOI_TRANG)}>
            Xem thêm
          </button>
        </div>
      )}
    </>
  );
}
