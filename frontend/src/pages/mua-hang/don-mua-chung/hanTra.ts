// Dòng "Hạn trả" — gộp số ngày NCC cho nợ với ngày chốt công nợ thành MỘT câu kết quả (phương án A,
// 15/10/2026). Cả hai là điều khoản của NHÀ CUNG CẤP (16/10/2026), đơn không có điều khoản riêng.
// Luật phải khớp `purchase_service.tinh_han_dot`: có ngày chốt HẰNG THÁNG
// (1–31, 31 = cuối tháng) thì mỗi đợt lấy mốc chốt gần nhất không sớm hơn ngày hoá đơn (chưa có thì
// ngày nhận hàng) cộng số ngày; không có thì mỗi đợt tính từ ngày hoá đơn của đợt đó.
import { fmtDate, hanTraTuMoc } from "../../../utils/format";

export type HanTra = {
  /** Câu chính: luật tính hạn của cả đơn. */
  chinh: string;
  /** Dòng nhỏ giải thích vì sao ra câu chính. */
  phu?: string;
  /** NCC chưa khai số ngày cho nợ ⇒ không suy ra được hạn. */
  chuaRo?: boolean;
};

/** "cuối tháng" / "ngày 25" — 31 đọc là cuối tháng vì tháng ngắn rơi về ngày cuối. */
export function nhanNgayChot(ngayChot: number): string {
  return ngayChot >= 31 ? "cuối tháng" : `ngày ${ngayChot}`;
}

/** Mốc chốt gần nhất không sớm hơn `ngay` (ISO) — chép `purchase_service.moc_chot_thang`. */
export function mocChotThang(ngay: string, ngayChot: number): string {
  const [y, m, d] = ngay.split("-").map(Number);
  const trongThang = (nam: number, thang: number) => Math.min(ngayChot, new Date(nam, thang, 0).getDate());
  let nam = y;
  let thang = m;
  let ngayMoc = trongThang(nam, thang);
  if (d > ngayMoc) {
    [nam, thang] = thang === 12 ? [nam + 1, 1] : [nam, thang + 1];
    ngayMoc = trongThang(nam, thang);
  }
  return `${nam}-${String(thang).padStart(2, "0")}-${String(ngayMoc).padStart(2, "0")}`;
}

export function moTaHanTra(soNgay: number | null | undefined, ngayChot: number | null | undefined): HanTra {
  if (soNgay == null) {
    return { chinh: "Chưa rõ", phu: "Nhà cung cấp chưa khai số ngày cho nợ", chuaRo: true };
  }
  if (ngayChot) {
    return {
      chinh: soNgay === 0 ? `Trả khi chốt ${nhanNgayChot(ngayChot)}` : `${soNgay} ngày sau chốt ${nhanNgayChot(ngayChot)}`,
      phu: `${ngayChot >= 31 ? "Chốt công nợ cuối mỗi tháng" : `Chốt công nợ ngày ${ngayChot} hằng tháng`}, hàng vào kỳ nào tính từ mốc chốt kỳ đó.`,
    };
  }
  if (soNgay === 0) return { chinh: "Trả ngay khi có hoá đơn" };
  return { chinh: `${soNgay} ngày sau ngày hoá đơn`, phu: "mỗi đợt giao một hạn" };
}

/** Hạn trả của MỘT đợt giao lúc đang gõ trong hộp Ghi đợt giao — chép `purchase_service.tinh_han_dot`
 *  (máy chủ chụp đúng con số này vào đợt lúc lưu). Lệch luật máy chủ là hộp hứa một hạn mà Công nợ
 *  canh một hạn khác. */
export function hanTraDot(
  soNgay: number | null | undefined,
  ngayChot: number | null | undefined,
  ngayHoaDon: string | null | undefined,
  ngayNhan: string | null | undefined,
): { ngay: string | null; giai: string } {
  const cong = soNgay == null || soNgay === 0 ? "" : ` cộng ${soNgay} ngày cho nợ`;
  const goc = ngayHoaDon || ngayNhan;
  if (soNgay != null && ngayChot && goc) {
    const moc = mocChotThang(goc, ngayChot);
    return {
      ngay: hanTraTuMoc(moc, soNgay),
      giai: ngayHoaDon
        ? `Hoá đơn ${fmtDate(ngayHoaDon)} vào kỳ chốt ${fmtDate(moc)}${cong}.`
        : `Chưa có hoá đơn nên lấy kỳ theo ngày nhận hàng: chốt ${fmtDate(moc)}${cong}.`,
    };
  }
  if (soNgay != null && ngayHoaDon) {
    return { ngay: hanTraTuMoc(ngayHoaDon, soNgay), giai: `Ngày hoá đơn ${fmtDate(ngayHoaDon)}${cong}.` };
  }
  if (soNgay != null && ngayNhan) {
    return {
      ngay: hanTraTuMoc(ngayNhan, soNgay),
      giai: `Chưa có hoá đơn nên tạm tính từ ngày nhận hàng ${fmtDate(ngayNhan)}${cong}. Có hoá đơn thì sửa đợt, hạn tự tính lại.`,
    };
  }
  return { ngay: null, giai: "Nhà cung cấp chưa khai số ngày cho nợ nên đợt này chưa có hạn." };
}
