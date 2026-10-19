/** Mảnh chung của hai sổ phiếu (Phiếu chi, Phiếu thu) theo phương án A (07/10/2026,
 *  docs/mockups/ke-toan-gon-3-phuong-an.html): dòng Cộng cuối lưới, ô số "–", tab
 *  "Chứng từ gốc" và các ô của cột thuộc tính trong ngăn kiểu 3. */
import type { ReactNode } from "react";

import { Cum, TheNho } from "./Cum";
import { ngayGio, vietSo } from "./dinhDang";
import type { TabNgan } from "./NganPhai";
import type { TheLoc as SoTheLoc } from "../../../api/client";

/** Dòng "Cộng n phiếu đã chi" cuối `tbody` của lưới `.kt-g`. Không có lớp `kt-dong` ⇒ không nhận
 *  phím, không mở ngăn. `truoc` = số cột trước ô tiền, `sau` = số cột sau (≥ 1: ô tiền tràn sang đó). */
export function DongCong({ so, chuXong, tongTien, truoc, sau }: {
  so: number;
  /** "đã chi" / "đã thu". */
  chuXong: string;
  tongTien: number;
  truoc: number;
  sau: number;
}) {
  return (
    <tr className="kt-g__cong">
      <td colSpan={truoc}>
        {`Cộng ${vietSo(so)} phiếu ${chuXong}`}
        <span className="kt-g__mo3" style={{ marginLeft: 8 }}>không tính phiếu đã hủy</span>
      </td>
      {/* Tổng có thể tới chục tỷ, rộng hơn cột tiền: không cắt "…" mà tràn sang ô trống bên phải. */}
      <td className="kt-g__so kt-g__tran">{vietSo(tongTien)}</td>
      {Array.from({ length: sau }, (_, i) => <td key={i} />)}
    </tr>
  );
}

/** Số phiếu đã xong KHỚP với tổng tiền máy chủ trả (`total_paid_amount` / `total_received_amount`
 *  cộng trên bộ lọc CÓ thẻ đang chọn, còn `the_loc` đếm trên nền KHÔNG có thẻ).
 *  null = thẻ đang xem không có phiếu đã xong (Đã hủy, Chờ thu) ⇒ không vẽ dòng Cộng. */
export function soPhieuCong(o: {
  the: string;
  n: SoTheLoc | null;
  /** Tổng số dòng của bảng (mọi trang). */
  tong: number;
}): number | null {
  // Thẻ "Đã chi"/"Đã thu" chỉ chứa phiếu đã xong ⇒ số dòng chính là số phiếu.
  if (o.the === "xong") return o.tong;
  if (o.the !== "tat_ca" || !o.n) return null;
  return o.n.xong;
}

/** Ô số của bảng đối chiếu: chưa biết (null) hoặc 0 thì gạch mờ "–". */
export function OSo({ so }: { so: number | null | undefined }) {
  if (so == null || so === 0) return <span className="lds-mu3">–</span>;
  return <>{vietSo(so)}</>;
}

/** Tab "Chứng từ gốc": có tệp thì đếm; phiếu đã xong mà chưa có tệp thì chữ amber "chưa có". */
export function tabChungTuGoc(soTep: number, phaiCo: boolean): TabNgan {
  if (soTep === 0 && phaiCo) {
    return { id: "ct", nhan: <>Chứng từ gốc{" "}<span className="kt-ghi-chu--thieu">chưa có</span></> };
  }
  return { id: "ct", nhan: "Chứng từ gốc", dem: soTep };
}

/** Ô tài khoản ở cột thuộc tính: "Techcombank 1903…" + thẻ chi nhánh. Không có gì thì null — gọi như
 *  HÀM `TaiKhoanO({...})`, KHÔNG viết `<TaiKhoanO/>` (element luôn khác null ⇒ `RayThuocTinh` vẫn hiện nhãn trơ). */
export function TaiKhoanO({ nganHang, so, chiNhanh }: {
  nganHang: string | null;
  so: string | null;
  chiNhanh: string | null;
}): ReactNode {
  const dau = [nganHang, so].filter(Boolean).join(" ");
  if (!dau && !chiNhanh) return null;
  return (
    <Cum>
      {dau && <span>{dau}</span>}
      {chiNhanh && <TheNho>{chiNhanh}</TheNho>}
    </Cum>
  );
}

/** Ô "Người lập": tên + thẻ giờ lập. */
export function NguoiLapO({ ten, moc }: { ten: string | null; moc: string }) {
  return (
    <Cum>
      <span>{ten || "—"}</span>
      <TheNho>{ngayGio(moc)}</TheNho>
    </Cum>
  );
}
