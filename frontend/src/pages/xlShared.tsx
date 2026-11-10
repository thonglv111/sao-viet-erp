// Helper NGÀY-GIỜ thuần dùng chung: ô chọn khoảng ngày (Xếp lịch, Thực hiện SX), bàn hẹn đẩy, lưới
// ngày của view Lịch bên Thực hiện SX. KHÔNG gọi API, KHÔNG giữ state. Gantt kéo thả cũ của Xếp lịch
// (thanh, hạn SX, giờ chạy) đã gỡ 08/11/2026 cùng tốc độ máy.

/** Bề rộng một ngày (px). Cột nhãn trái + 7 cột này = bề ngang lưới. */
export const NGAY_W = 168;
export const NHAN_W = 260;
/** Đủ cho BỐN dòng nhãn (mã · tên · khách · sản lượng/tờ/con) và, bên lưới, một dải chữ dưới
 *  thanh cho vạch "hạn SX" / "giao khách". */
export const DONG_H = 90;

/** Hình học lưới theo bề ngang cửa sổ. Cột nhãn là cột DÍNH (`position: sticky`) nên trên màn
 *  375px nó ăn 260/375 = 70% chỗ, lưới còn hơn trăm pixel — nhìn thấy đúng một mẩu thanh. Hai nấc
 *  hẹp co nhãn lại và hạ bề rộng một ngày để lưới còn thấy được.
 *
 *  HÀM THUẦN, cố ý: ai gọi tự lo nghe `resize`.
 *  Bề ngang > 768px trả về ĐÚNG số cũ — màn rộng không đổi một pixel.
 *  Ngưỡng 768/480 khớp với @media §78 của `styles/responsive.css`; đổi ở đây phải đổi cả bên đó. */
export function khungLuoi(
  beNgang: number,
  soNgay: number,
): { nhanW: number; ngayW: number; dongH: number } {
  const nac = nacCuaSo(soNgay);
  const ngayRong = (bay: number, muoiBon: number, baMuoi: number) =>
    nac === 30 ? baMuoi : nac === 14 ? muoiBon : bay;
  if (beNgang <= 480) return { nhanW: 184, ngayW: ngayRong(96, 64, 36), dongH: 90 };
  if (beNgang <= 768) return { nhanW: 184, ngayW: ngayRong(120, 76, 42), dongH: 90 };
  return { nhanW: NHAN_W, ngayW: ngayRong(NGAY_W, 96, 54), dongH: DONG_H };
}

/** Nấc hiển thị của cửa sổ — 7, 14 hay 30 ngày. Ba nút có sẵn rơi đúng nấc của mình; khoảng tự
 *  chọn (20 ngày, 45 ngày…) rơi vào nấc có bề ngang lưới gần nhất. Bề rộng một ngày và kiểu đầu cột
 *  ngày đều đọc nấc này, nên khoảng lẻ dùng lại đúng bộ số đã chỉnh cho ba nấc chứ không đẻ cỡ mới. */
export function nacCuaSo(soNgay: number): 7 | 14 | 30 {
  return soNgay <= 9 ? 7 : soNgay <= 20 ? 14 : 30;
}

/** Trần một lần xem — BA THÁNG (mockup A cải tiến, 08/10/2026: "Dài nhất 3 tháng"). `/lich` trải
 *  MỌI lệnh chạm cửa sổ, cửa sổ càng dài càng nặng; dài hơn thì lùi/tiến bằng mũi tên. */
export const SO_NGAY_TOI_DA = 92;

export const NGAY_NHAP_MIN = "2000-01-01";
export const NGAY_NHAP_MAX = "2099-12-31";

/** Số ngày tính cả hai đầu của khoảng `tu`..`den` (YYYY-MM-DD). Đếm theo UTC để giờ mùa hè không
 *  làm hụt một ngày. */
export function soNgayGiua(tu: string, den: string): number {
  const [y1, m1, d1] = tu.split("-").map(Number);
  const [y2, m2, d2] = den.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000) + 1;
}

/** Lời nhắc cho ô chọn khoảng ngày, `null` = dùng được. Ô `date` nhận năm 6 chữ số và năm gõ dở
 *  (0020) nên soi khuôn + khoảng, không tin mỗi `min`/`max` trên thẻ. */
export function loiKhoangNgay(tu: string, den: string): string | null {
  const hopLe = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && v >= NGAY_NHAP_MIN && v <= NGAY_NHAP_MAX;
  if (!tu || !den) return "Chọn đủ từ ngày và đến ngày.";
  if (!hopLe(tu) || !hopLe(den)) return "Ngày không hợp lệ.";
  if (den < tu) return "Đến ngày phải từ ngày bắt đầu trở đi.";
  if (soNgayGiua(tu, den) > SO_NGAY_TOI_DA) return "Mỗi lần xem tối đa 3 tháng.";
  return null;
}

// ---------------------------------------------------------------- ngày tháng
export function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function themNgay(s: string, n: number): string {
  const [y, mo, d] = s.split("-").map(Number);
  return ymd(new Date(y, mo - 1, d + n));
}

/** Thứ Hai của tuần chứa `d`. Cửa sổ luôn bắt đầu từ thứ Hai — nhảy tuần mà mốc trôi theo ngày bấm
 *  thì hai lần mở màn ra hai khung khác nhau, người dùng mất điểm neo. */
export function dauTuan(d: Date): string {
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  t.setDate(t.getDate() - ((t.getDay() + 6) % 7));
  return ymd(t);
}

/** ISO naive (giờ nhà máy, KHÔNG đổi múi) → mốc mili-giây để tính hình học. */
export function moc(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime();
}

export function mocNgay(d: string): number {
  const [y, mo, dd] = d.split("-").map(Number);
  return new Date(y, mo - 1, dd).getTime();
}

// ---------------------------------------------------------------- định dạng
/** "10/09 19:00" — ngày đứng trước giờ, cho nhãn "xong …" cạnh thanh: mắt đang dò theo trục NGÀY
 *  nên ngày phải đọc được trước. */
export function ngayGio(iso: string | null | undefined): string {
  const m = iso?.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  return m ? `${m[3]}/${m[2]} ${m[4]}:${m[5]}` : "—";
}

/** Phút → "6 giờ 30 phút" / "45 phút" — giờ ĐỒNG HỒ cho mọi thời lượng của màn: giờ chạy của bước,
 *  của lệnh, phần nghỉ. KHÔNG quy ra "ngày làm 8 tiếng": hàm cũ `thoiLuong` (gỡ 14/09/2026) ghi 20 giờ
 *  đóng gói thành "2 ngày 4 giờ", người đọc hiểu 48 giờ; còn chủ nhật 24 giờ nằm chờ thành "3 ngày". */
export function gioChu(phut: number | null | undefined): string {
  const p = Math.max(0, Math.round(phut ?? 0));
  const g = Math.floor(p / 60);
  const m = p % 60;
  if (!g) return `${m} phút`;
  return m ? `${g} giờ ${m} phút` : `${g} giờ`;
}


export const THU = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

export function nhanNgay(d: string): { thu: string; so: string; homNay: boolean } {
  const [y, mo, dd] = d.split("-").map(Number);
  const dt = new Date(y, mo - 1, dd);
  return { thu: THU[dt.getDay()], so: `${dd}/${mo}`, homNay: ymd(new Date()) === d };
}
