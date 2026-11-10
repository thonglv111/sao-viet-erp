// Dự báo tồn của MỘT dòng màn Tồn kho — thuần hàm, không React, test được.
//
// Số lệnh cần + thứ tự ăn tồn lấy nguyên từ bảng cân đối vật tư (máy chủ trả qua `/lo/du-bao`);
// ở đây chỉ trải chúng ra theo ngày trên nền tồn của KHO NÀY và so với ngưỡng của kho này:
//
//   Dự kiến = Tồn khả dụng − Σ lệnh còn phải lĩnh + Σ hàng đang về
//   Cần mua  = có LÚC NÀO số còn lại chạm/dưới Tối thiểu (kể cả ngay bây giờ) — hàng về sau ngày
//              thủng không cứu được lệnh lĩnh trước đó
//   Đề nghị mua = đủ để (a) về lại Tối đa (trống thì Tối thiểu) ở cuối chuỗi và (b) điểm thấp nhất
//              không rơi dưới Tối thiểu — lấy số lớn hơn
//   Sẽ vượt tối đa = không cần mua nhưng có lúc số còn lại trên Tối đa (thường do đơn mua về dồn)
//
// Không ngưỡng thì vẫn nói được một điều chắc chắn: số còn lại âm = lệnh lĩnh không đủ.
// Việc có ngày đã qua mà chưa xong (lệnh chưa lĩnh, đơn chưa về) gắn `tre` = số ngày trễ: máy vẫn
// tính nó như sẽ xảy ra ngay, nhưng giao diện phải nói rõ là đang trễ hẹn.
import type { LoaiMua, MuaChoLenh, DuBaoLenhRow, DuBaoTonRow, StockThreshold } from "../../api/client";

/** Vùng của một số tồn so với ngưỡng: dưới/chạm tối thiểu, trong ngưỡng, trên tối đa. */
export type Vung = "do" | "la" | "cam";

interface SuKienChung {
  ngay: string | null;
  sl: number;
  conLai: number;
  /** Số ngày đã trễ so với hôm nay (0 = chưa tới hạn hoặc chưa có hạn). */
  tre: number;
  /** null khi chưa khai ngưỡng (chỉ âm mới là đỏ). */
  vung: Vung | null;
  /** Thứ tự gốc sau khi sắp — khoá ổn định để biểu đồ và danh sách trỏ nhau. */
  i: number;
}

export type SuKien =
  | (SuKienChung & { loai: "lenh"; lenh: DuBaoLenhRow })
  | (SuKienChung & {
      loai: "ve"; ngay: string; ma: string | null;
      /** Đơn về này mua cho tồn kho / theo yêu cầu / lệnh nào (08/10/2026). */
      muaCho?: MuaChoLenh[]; loaiMua?: LoaiMua[];
    });

export type TrangThaiDuBao = "can_mua" | "vuot" | "du";

export interface DuBao {
  ton: number;
  canLenh: number;
  dangVe: number;
  duKien: number;
  suKien: SuKien[];
  /** Mốc đầu tiên số còn lại rơi dưới Tối thiểu (hoặc dưới 0 khi chưa khai ngưỡng). `"nay"` = đã
   *  dưới ngay bây giờ hoặc việc làm thủng đã trễ hẹn; `null` = không rơi. */
  moc: string | "nay" | null;
  /** Có lúc chạm/dưới Tối thiểu (chưa khai ngưỡng: có lúc âm) ⇒ cần mua. */
  canMua: boolean;
  /** Riêng số Dự kiến cuối chuỗi đã chạm/dưới Tối thiểu (hoặc âm) — tô đỏ ô Dự kiến. */
  duoiCuoi: boolean;
  /** Mốc đầu tiên số còn lại vượt Tối đa; `"nay"` = tồn hiện có đã vượt. */
  mocVuot: string | "nay" | null;
  trangThai: TrangThaiDuBao;
  /** Số còn lại thấp nhất / cao nhất trên cả chuỗi (gồm tồn hiện có). */
  thapNhat: number;
  caoNhat: number;
  /** Phần thiếu so với Tối thiểu ở điểm thấp nhất (chưa khai ngưỡng: phần âm). */
  thieu: number;
  /** Phần dư trên Tối đa ở điểm cao nhất (0 khi không vượt). */
  duMax: number;
  /** Số đề nghị mua (0 khi không cần mua). */
  deNghi: number;
  /** Đích của số đề nghị — để in câu "Mua X thì về lại mức tối đa 7.000". `day` = số đề nghị đến
   *  từ việc đỡ điểm thấp nhất chứ không phải từ cuối chuỗi. */
  dich: { nhan: "Tối đa" | "Tối thiểu" | "Thiếu"; so: number; day: boolean } | null;
  /** Việc đã quá hẹn mà chưa xong. */
  tre: SuKien[];
}

const lamTron = (n: number) => Math.round(n * 1000) / 1000;

/** Hôm nay theo giờ máy (không qua UTC — 7h sáng ở VN vẫn là hôm qua theo UTC). */
export function homNayIso(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function soNgayGiua(tu: string, den: string): number {
  return Math.round((Date.parse(`${den}T00:00:00Z`) - Date.parse(`${tu}T00:00:00Z`)) / 86400000);
}

export function vungCua(n: number, th: StockThreshold | undefined): Vung | null {
  if (!th) return n < 0 ? "do" : null;
  if (n <= th.nguong_ton) return "do";
  if (th.nguong_toi_da != null && n > th.nguong_toi_da) return "cam";
  return "la";
}

export function tinhDuBao(
  ton: number,
  du: DuBaoTonRow | undefined,
  th: StockThreshold | undefined,
  homNay: string = homNayIso(),
): DuBao {
  const lenh = du?.lenh ?? [];
  const ve = du?.ve ?? [];
  // Trộn theo ngày. Cùng ngày thì LĨNH trước, VỀ sau — hàng về chiều không cứu lệnh lĩnh sáng.
  // Lệnh chưa có hạn giao đứng đầu: không biết bao giờ lĩnh thì coi như lĩnh ngay.
  type Tho = { ngay: string | null; thu: number; j: number; ev: { loai: "lenh"; lenh: DuBaoLenhRow } | { loai: "ve"; ma: string | null; muaCho?: MuaChoLenh[]; loaiMua?: LoaiMua[] }; sl: number };
  const tho: Tho[] = [
    ...lenh.map((l, j) => ({ ngay: l.han_giao, thu: 0, j, sl: l.can, ev: { loai: "lenh" as const, lenh: l } })),
    ...ve.map((v, j) => ({ ngay: v.ngay_ve, thu: 1, j, sl: v.sl, ev: { loai: "ve" as const, ma: v.ma, muaCho: v.mua_cho, loaiMua: v.loai_mua_cac } })),
  ];
  tho.sort((a, b) => {
    const na = a.ngay ?? "", nb = b.ngay ?? "";
    if (na !== nb) return na < nb ? -1 : 1;
    return a.thu - b.thu || a.j - b.j;
  });

  const min = th?.nguong_ton ?? null;
  const max = th?.nguong_toi_da ?? null;
  // Chạm Tối thiểu là đã Cần mua — cùng luật `stock_level` của máy chủ (chip trạng thái).
  const duoi = (n: number) => (min != null ? n <= min : n < 0);
  const tren = (n: number) => max != null && n > max;
  // Việc trễ hẹn coi như xảy ra hôm nay ⇒ mốc của nó là "nay".
  const mocCua = (t: Tho) => (!t.ngay || t.ngay < homNay ? "nay" : t.ngay);

  let conLai = ton;
  let moc: DuBao["moc"] = duoi(ton) ? "nay" : null;
  let mocVuot: DuBao["mocVuot"] = tren(ton) ? "nay" : null;
  let thapNhat = ton;
  let caoNhat = ton;
  const suKien: SuKien[] = tho.map((t, i) => {
    conLai = lamTron(conLai + (t.ev.loai === "lenh" ? -t.sl : t.sl));
    if (moc == null && duoi(conLai)) moc = mocCua(t);
    if (mocVuot == null && tren(conLai)) mocVuot = mocCua(t);
    thapNhat = Math.min(thapNhat, conLai);
    caoNhat = Math.max(caoNhat, conLai);
    const tre = t.ngay && t.ngay < homNay ? soNgayGiua(t.ngay, homNay) : 0;
    const chung = { ngay: t.ngay, sl: t.sl, conLai, tre, vung: vungCua(conLai, th), i };
    return t.ev.loai === "lenh"
      ? { ...chung, loai: "lenh" as const, lenh: t.ev.lenh }
      : { ...chung, loai: "ve" as const, ngay: t.ngay as string, ma: t.ev.ma, muaCho: t.ev.muaCho, loaiMua: t.ev.loaiMua };
  });

  const canLenh = lamTron(lenh.reduce((s, l) => s + l.can, 0));
  const dangVe = lamTron(ve.reduce((s, v) => s + v.sl, 0));
  const duKien = lamTron(ton - canLenh + dangVe);
  const canMua = duoi(thapNhat);
  const thieu = canMua ? lamTron((min ?? 0) - thapNhat) : 0;
  const duMax = max != null && caoNhat > max ? lamTron(caoNhat - max) : 0;

  let dich: DuBao["dich"] = null;
  let deNghi = 0;
  if (canMua) {
    const nhan = max != null ? "Tối đa" : min != null ? "Tối thiểu" : "Thiếu";
    const so = max ?? min ?? 0;
    const veDich = Math.max(0, Math.ceil(so - duKien));
    // Đỡ điểm thấp nhất về lại mức tối thiểu (chưa khai ngưỡng: về 0).
    const doDay = Math.ceil(thieu);
    deNghi = Math.max(veDich, doDay);
    dich = { nhan, so, day: doDay > veDich };
  }
  const trangThai: TrangThaiDuBao = canMua ? "can_mua" : mocVuot != null ? "vuot" : "du";
  return {
    ton, canLenh, dangVe, duKien, suKien, moc, canMua, duoiCuoi: duoi(duKien), mocVuot, trangThai,
    thapNhat, caoNhat, thieu, duMax, deNghi, dich, tre: suKien.filter((s) => s.tre > 0),
  };
}

/** Ngày cần hàng cho yêu cầu mua: mốc đầu tiên rơi dưới ngưỡng; đã dưới (hoặc mốc đã qua) thì hôm nay. */
export function ngayCanMua(d: DuBao, homNay: string): string {
  if (d.moc == null || d.moc === "nay" || d.moc < homNay) return homNay;
  return d.moc;
}

/** Vị trí (%) trên thang của thanh ngưỡng: thang = 115% của số lớn nhất trong tồn, min, max. */
export function thangNguong(ton: number, min: number, max: number | null, them: number[] = []): number {
  return Math.max(ton, min, max ?? 0, ...them, 1) * 1.15;
}
