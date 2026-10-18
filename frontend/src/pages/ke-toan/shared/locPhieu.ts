/** Điều kiện lọc DÙNG CHUNG của hai sổ phiếu — Phiếu chi và Phiếu thu (đặc tả PC-1, PT-1, A.18),
 *  đặt trên thanh lọc chung `ThanhLoc` (06/10/2026).
 *
 *  Hai màn có cùng bốn điều kiện: Số tiền (khoảng), Hình thức, Mục (nhiều) và Tài khoản công ty
 *  (điều kiện Chứng từ gỡ 18/10/2026). Lọc Mục thay lọc Nguồn từ 11/10/2026 — danh sách mục nạp từ danh mục Mục thu chi. Tên người nhận / người nộp
 *  tìm bằng ô tìm (máy chủ so cả tên người trong `q`). File này là hàm thuần, không React.
 */
import { ArrowLeftRight, Banknote, Landmark, Layers } from "lucide-react";

import type { CompanyBankAccountRow, LocPhieu, TheLoc as SoTheLoc } from "../../../api/client";
import { dkTheoTab, type DieuKien, type GiaTriDK } from "../../thanh-loc/thanh-loc";

/** Bộ lọc ĐÃ ÁP. `muc` = id mục thu chi; `0` = phiếu chưa phân loại. */
export type LocNangCao = {
  tien_tu?: number;
  tien_den?: number;
  hinh_thuc?: "cash" | "bank_transfer";
  muc: number[];
  tai_khoan_id?: number;
};

export const LOC_TRONG: LocNangCao = { muc: [] };

/** Phần tham số máy chủ do bộ lọc quyết định (không gồm thẻ, kỳ, ô tìm). */
export function thamSoNangCao(
  loc: LocNangCao,
): Pick<LocPhieu, "tien_tu" | "tien_den" | "hinh_thuc" | "muc" | "tai_khoan_id"> {
  return {
    tien_tu: loc.tien_tu,
    tien_den: loc.tien_den,
    hinh_thuc: loc.hinh_thuc,
    muc: loc.muc,
    tai_khoan_id: loc.tai_khoan_id,
  };
}

export function soDieuKien(loc: LocNangCao): number {
  let n = 0;
  if (loc.tien_tu != null || loc.tien_den != null) n++;
  if (loc.hinh_thuc) n++;
  if (loc.muc.length) n++;
  if (loc.tai_khoan_id != null) n++;
  return n;
}

/* ---------- Điều kiện trên thanh lọc ---------- */

const HINH_THUC: GiaTriDK[] = [
  { value: "cash", nhan: "Tiền mặt" },
  { value: "bank_transfer", nhan: "Chuyển khoản" },
];

/** Chữ riêng của từng sổ. */
export type CauHinhLocPhieu = {
  /** "Mục chi" / "Mục thu". */
  nhanMuc: string;
  /** "Trả từ tài khoản" / "Vào tài khoản". */
  nhanTaiKhoan: string;
};

export function tenTaiKhoan(tk: Pick<CompanyBankAccountRow, "bank_name" | "account_number">): string {
  return `${tk.bank_name} ${tk.account_number}`;
}

/** Lựa chọn "Chưa phân loại" của điều kiện Mục — phiếu chưa gắn mục nào. */
export const MUC_CHUA_PHAN_LOAI = "Chưa phân loại";

/** Điều kiện của một sổ phiếu. `taiKhoan` null = không có quyền xem Tài khoản ngân hàng ⇒ không có
 *  điều kiện tài khoản. `muc` = mục cùng loại của danh mục (kể cả mục đã ngừng — phiếu cũ vẫn mang). */
export function dieuKienPhieu(
  ch: CauHinhLocPhieu,
  taiKhoan: CompanyBankAccountRow[] | null,
  muc: { id: number; ten: string }[] = [],
): DieuKien<LocNangCao>[] {
  const ds: DieuKien<LocNangCao>[] = [
    {
      khoa: "tien", nhan: "Số tiền", icon: Banknote, kieu: "khoang", donVi: "đ",
      doc: (l) => [l.tien_tu, l.tien_den],
      ghi: (l, tu, den) => ({ ...l, tien_tu: tu, tien_den: den }),
    },
    {
      khoa: "hinh_thuc", nhan: "Hình thức", icon: ArrowLeftRight, kieu: "mot", giaTri: HINH_THUC,
      doc: (l) => l.hinh_thuc,
      ghi: (l, v) => ({ ...l, hinh_thuc: v as LocNangCao["hinh_thuc"] }),
    },
    {
      khoa: "muc", nhan: ch.nhanMuc, icon: Layers, kieu: "nhieu", tim: true,
      giaTri: [{ value: "0", nhan: MUC_CHUA_PHAN_LOAI }, ...muc.map((m) => ({ value: String(m.id), nhan: m.ten }))],
      doc: (l) => l.muc.map(String),
      ghi: (l, v) => ({ ...l, muc: v.map(Number) }),
    },
  ];
  if (taiKhoan) {
    ds.push({
      khoa: "tai_khoan", nhan: ch.nhanTaiKhoan, icon: Landmark, kieu: "mot",
      tim: true, giaTri: taiKhoan.map((tk) => ({ value: String(tk.id), nhan: tenTaiKhoan(tk) })),
      doc: (l) => (l.tai_khoan_id == null ? undefined : String(l.tai_khoan_id)),
      ghi: (l, v) => ({ ...l, tai_khoan_id: v == null ? undefined : Number(v) }),
    });
  }
  return ds;
}

/** Điều kiện "Trạng thái" trong nút Lọc = hàng thẻ lọc của sổ (07/10/2026): đọc/ghi thẳng thẻ đang
 *  chọn, không state thứ hai. `muc` là các thẻ CÓ BẢNG (Phiếu chi bỏ "Gia công chờ chi" — thẻ đó
 *  thay cả bảng lẫn thanh lọc). Số đếm lấy từ `the_loc` máy chủ trả. */
export function dkTrangThaiPhieu(o: {
  /** Chỉ cần mã + nhãn của mục dải tab (`MucTab`). */
  muc: { id: string; nhan: string }[];
  n: SoTheLoc | null;
  dang: string;
  dat: (id: string) => void;
}): DieuKien<LocNangCao> {
  const so = (id: string): number | undefined => {
    if (!o.n) return undefined;
    if (id === "xong") return o.n.xong;
    if (id === "da_huy") return o.n.da_huy;
    if (id === "cho") return o.n.cho;
    return undefined;
  };
  return dkTheoTab<LocNangCao>({
    tabs: o.muc.map((m) => ({ id: m.id, nhan: m.nhan, so: so(m.id) })),
    tatCa: "tat_ca",
    dang: o.dang,
    dat: o.dat,
  });
}

/* ---------- URL (đặc tả A.18) ---------- */

/** Số nguyên dương an toàn từ URL; rác thì undefined. */
export function soDuong(v: string | null): number | undefined {
  if (v == null || !/^\d+$/.test(v)) return undefined;
  const n = Number(v);
  return Number.isSafeInteger(n) ? n : undefined;
}

/** Bộ lọc → khoá URL (`muc=3,0`). Giá trị mặc định ⇒ undefined (khoá bị bỏ khỏi URL). */
export function locNangCaoLenUrl(loc: LocNangCao): Record<string, string | undefined> {
  return {
    tien_tu: loc.tien_tu != null ? String(loc.tien_tu) : undefined,
    tien_den: loc.tien_den != null ? String(loc.tien_den) : undefined,
    hinh_thuc: loc.hinh_thuc,
    muc: loc.muc.length ? loc.muc.join(",") : undefined,
    tk: loc.tai_khoan_id != null ? String(loc.tai_khoan_id) : undefined,
  };
}

/** Khoá URL → bộ lọc. Giá trị rác thì bỏ qua từng khoá (không làm hỏng cả bộ lọc). */
export function locNangCaoTuUrl(p: URLSearchParams): LocNangCao {
  const loc: LocNangCao = { muc: [] };
  const tienTu = soDuong(p.get("tien_tu"));
  const tienDen = soDuong(p.get("tien_den"));
  if (tienTu != null) loc.tien_tu = tienTu;
  if (tienDen != null) loc.tien_den = tienDen;
  const ht = p.get("hinh_thuc");
  if (ht === "cash" || ht === "bank_transfer") loc.hinh_thuc = ht;
  // Id âm = mục cố định theo nguồn phiếu (Trả nhà cung cấp…), 0 = chưa phân loại.
  loc.muc = [...new Set((p.get("muc") ?? "").split(",")
    .map((v) => (/^-?\d+$/.test(v) ? Number(v) : NaN))
    .filter((n) => Number.isSafeInteger(n)))];
  const tk = soDuong(p.get("tk"));
  if (tk != null && tk > 0) loc.tai_khoan_id = tk;
  return loc;
}
