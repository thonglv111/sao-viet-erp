/** Hàm THUẦN của Gia công ngoài (spec docs/superpowers/specs/2026-09-26-gia-cong-ngoai-design.md).
 *  Không gọi API, không React — vitest soi thẳng. */
import type {
  GiaCongCapGiay, GiaCongNgoaiLan, GiaCongNoiVe, GiaCongTrangThai, LsxLoaiBuoc,
} from "../../api/client";

/** Tối thiểu một bước cần có để suy dải — `EditRow` của bảng routing khớp kiểu này. */
export interface BuocDai {
  /** `step_key` — khớp `LsxCongDoanPhuThuoc.buoc_truoc_id`/`buoc_sau_id` ở server. */
  key: string;
  ten: string;
  loai_buoc: LsxLoaiBuoc;
  nha_cung_cap_id: number | null;
  /** Tiền nhiệm TRỰC TIẾP của bước này (cạnh DAG `truoc → bước này`). */
  phu_thuoc_step_keys: string[];
}

export interface ViTriDai {
  /** Tên bước liền trước CÙNG lần (null = bước này mở đầu lần). */
  truoc: string | null;
  /** Tên bước liền sau CÙNG lần (null = bước này là cuối lần). */
  sau: string | null;
  /** Bước cuối của lần — nơi khai đơn giá CẢ lần. */
  laCuoi: boolean;
}

/** Lệnh có khai ÍT NHẤT một cạnh phụ thuộc không — routing tuyến tính cũ (chưa từng khai cạnh
 *  nào) thì "liền nhau" lùi về so THỨ TỰ MẢNG, đúng luật server (`_quet_dai_thue_ngoai`). */
function coCanhNao(rows: BuocDai[]): boolean {
  return rows.some((r) => r.phu_thuoc_step_keys.length > 0);
}

/** Có cạnh DAG `a → c` không (c liệt `a.key` trong tiền nhiệm trực tiếp của nó). */
function coCanh(a: BuocDai, c: BuocDai): boolean {
  return c.phu_thuoc_step_keys.includes(a.key);
}

function cungLan(rows: BuocDai[], a: BuocDai | undefined, c: BuocDai | undefined): boolean {
  if (!a || !c) return false;
  if (a.loai_buoc !== "thue_ngoai" || c.loai_buoc !== "thue_ngoai") return false;
  if (a.nha_cung_cap_id == null || a.nha_cung_cap_id !== c.nha_cung_cap_id) return false;
  // "Liền nhau" đi theo CẠNH DAG — hai nhánh song song của cùng một bước cha KHÔNG liền nhau, dù
  // đứng sát nhau trong mảng `rows`. Routing KHÔNG khai cạnh nào (tuyến tính cũ) thì lùi về so
  // thứ tự mảng, cùng luật `_quet_dai_thue_ngoai` (`services/gia_cong_ngoai/lan.py`).
  return !coCanhNao(rows) || coCanh(a, c);
}

/** Vị trí của bước `i` trong DẢI gia công. Cùng luật với máy chủ lúc phát hành
 *  (`services/gia_cong_ngoai/lan.py::gom_lan_khi_phat_hanh` → `_quet_dai_thue_ngoai` +
 *  `_canh_ke_tiep`): các bước Thuê ngoài LIỀN NHAU theo CẠNH DAG (không phải theo thứ tự bảng),
 *  CÙNG nhà gia công ⇒ MỘT lần. `null` khi bước không phải thuê ngoài. */
export function viTriTrongDai(rows: BuocDai[], i: number): ViTriDai | null {
  const r = rows[i];
  if (!r || r.loai_buoc !== "thue_ngoai") return null;
  const truoc = cungLan(rows, rows[i - 1], r) ? rows[i - 1].ten : null;
  const sau = cungLan(rows, r, rows[i + 1]) ? rows[i + 1].ten : null;
  return { truoc, sau, laCuoi: sau == null };
}

export const NHAN_TRANG_THAI: Record<GiaCongTrangThai, string> = {
  cho_mang_di: "Chờ mang đi",
  dang_o_ngoai: "Đang ở nhà gia công",
  // Trọn gói: tiêu đề thẻ đã nói "trọn gói" — chip chỉ nói hàng đang ở đâu.
  dang_gia_cong: "Đang ở nhà gia công",
  da_xong: "Đã nhận về",
  da_huy: "Đã huỷ",
};

/** Nhãn NGẮN cho chip chật (dòng bảng lệnh). */
export const NHAN_NGAN: Record<GiaCongTrangThai, string> = {
  cho_mang_di: "chờ mang đi",
  dang_o_ngoai: "đang ở ngoài",
  dang_gia_cong: "đang gia công",
  da_xong: "đã nhận về",
  da_huy: "đã huỷ",
};

export const NHAN_NOI_VE: Record<GiaCongNoiVe, string> = {
  xuong: "Về xưởng làm tiếp",
  kho: "Nhập kho thành phẩm",
  khach: "Giao thẳng cho khách",
};

export interface NutLan {
  mangDi: boolean;
  chot: boolean;
  moLai: boolean;
  /** Trọn gói xưởng cấp giấy chưa gửi đề nghị xuất — dải "Chưa cấp giấy" + nút "Chọn giấy". */
  chonGiay: boolean;
  huyTronGoi: boolean;
}

/** Nút nào hiện với lần này — cùng các chốt chặn của máy chủ (Task 6–9), để người dùng không bấm
 *  vào một nút chắc chắn bị từ chối. Máy chủ vẫn là nơi quyết. */
export function nutCuaLan(l: GiaCongNgoaiLan): NutLan {
  const motPhan = l.kieu === "mot_phan";
  const conMo = l.trang_thai === "cho_mang_di" || l.trang_thai === "dang_o_ngoai";
  return {
    mangDi: motPhan && conMo
      && (l.sl_cho_mang_di > 0 || (l.trang_thai === "cho_mang_di" && !l.co_buoc_truoc)),
    chot: l.trang_thai === "dang_o_ngoai" || l.trang_thai === "dang_gia_cong",
    moLai: l.trang_thai === "da_xong" && l.phieu_chi == null,
    // Máy chủ chỉ gửi `cap_giay` khi lần đang chờ cấp giấy — cùng luật `cho_cap_giay` phía máy chủ.
    chonGiay: l.kieu === "tron_goi" && l.trang_thai === "dang_gia_cong" && l.cap_giay != null,
    huyTronGoi: l.kieu === "tron_goi" && l.trang_thai === "dang_gia_cong",
  };
}

/** Giá trị điền sẵn của mini-form Chốt — "hai click" (spec §7). */
export function goiYChot(l: GiaCongNgoaiLan): { sl: string; noiVe: GiaCongNoiVe | null; dich: number | null } {
  const sl = l.sl_goi_y_chot ?? l.sl_gui ?? l.sl_dat;
  return {
    sl: sl != null ? String(sl) : "",
    noiVe: l.noi_ve_hop_le[0] ?? null,
    dich: l.chang_sau.length === 1 ? l.chang_sau[0].id : null,
  };
}

const so = (n: number) => n.toLocaleString("vi-VN");

/** Một mốc trên dải tiến độ của lần: ai, lúc nào, bao nhiêu — mỗi mảnh một ô riêng (không nối
 *  chuỗi bằng "·"). `muc`: xong = đã qua · dang = lần đang đứng ở đây · cho = chưa tới. */
export interface MocLan {
  nhan: string;
  muc: "xong" | "dang" | "cho";
  luc: string | null;
  ai: string | null;
  so: string | null;
}

/** Ba mốc của lần (spec §7: giao việc → ở ngoài → nhận về). Trọn gói không có "mang đi": đặt là
 *  hàng đã ở nhà gia công. Lần huỷ vẫn trả mốc đã qua — nơi gọi vẽ thêm dòng huỷ. */
export function mocCuaLan(l: GiaCongNgoaiLan, dvTen: (ma: string | null) => string): MocLan[] {
  const huy = l.trang_thai === "da_huy";
  const xong = l.chot_luc != null;
  const soDv = (n: number | null, dv: string | null) =>
    n != null ? `${so(n)} ${dvTen(dv)}`.trim() : null;
  const nhanVe: MocLan = {
    nhan: "Nhận về", muc: xong ? "xong" : "cho",
    luc: l.chot_luc, ai: l.chot_boi_ten, so: soDv(l.sl_cuoi, l.don_vi),
  };
  if (l.kieu === "tron_goi") {
    return [
      { nhan: "Giao việc", muc: "xong", luc: l.tao_luc ?? null, ai: l.tao_boi_ten ?? null,
        so: soDv(l.sl_dat, l.don_vi) },
      { nhan: "Đang gia công", muc: xong ? "xong" : huy ? "cho" : "dang", luc: null, ai: null, so: null },
      nhanVe,
    ];
  }
  const daMang = l.mang_di_luc != null;
  return [
    { nhan: "Phát hành", muc: "xong", luc: l.tao_luc ?? null, ai: l.tao_boi_ten ?? null, so: null },
    { nhan: "Mang đi", muc: daMang ? "xong" : huy ? "cho" : "dang",
      luc: l.mang_di_luc, ai: l.mang_di_boi_ten, so: soDv(l.sl_gui, l.don_vi_gui) },
    { ...nhanVe, muc: xong ? "xong" : daMang && !huy ? "dang" : "cho" },
  ];
}

type DongChia = NonNullable<GiaCongNgoaiLan["chia_theo_lenh"]>[number];

/** Ô "Nhận" của bảng chia về từng lệnh: số chốt × `he_so_nhan` theo đơn vị bước nhận. Bước nhận ăn
 *  tờ ghép (Cắt, Bế — hệ số 1) thì kèm số con nó sẽ ra, để người chốt thấy phần của lệnh. Máy chủ
 *  cũ chưa trả `he_so_nhan` ⇒ lùi về số con/tờ như trước. */
export function soNhanChia(sl: number, c: DongChia, dvTen: (ma: string | null) => string): string {
  const lam = (n: number) => so(Math.round(n * 1000) / 1000);
  const heSo = c.he_so_nhan ?? c.so_con;
  const nhan = `${lam(sl * heSo)} ${dvTen(c.don_vi)}`.trim();
  return heSo !== c.so_con ? `${nhan} (ra ${lam(sl * c.so_con)} con)` : nhan;
}

/** Trạng thái đề nghị xuất giấy nói theo phía người kế hoạch — "kho đang làm tới đâu". */
export const NHAN_XUAT_GIAY: Record<string, string> = {
  approved: "Chờ kho soạn",
  received: "Kho đã nhận",
  preparing: "Kho đang soạn",
  partial: "Đã xuất một phần",
  done: "Đã xuất đủ",
};

/** Giá trị ban đầu của phần "Chọn giấy": khổ đề xuất (nếu kho có khổ đó trong danh sách) + số tờ
 *  điền sẵn theo đề xuất. Không có khổ đề xuất ⇒ chưa chọn gì, ô số để trống. */
export function chonGiayBanDau(cg: GiaCongCapGiay): { kho: string | null; so: string } {
  const dx = cg.de_xuat;
  if (!dx) return { kho: null, so: "" };
  return { kho: `${dx.kho_rong}x${dx.kho_dai}`, so: dx.so_to != null ? String(dx.so_to) : "" };
}

/** Nhãn một dòng "Khổ trong kho": cuộn (khổ `(rộng, 0)`, đếm kg) đọc theo rộng, tờ đọc hai cạnh. */
export function nhanKhoCap(r: number, d: number): string {
  return d ? `khổ ${r} × ${d} mm` : `cuộn rộng ${r} mm`;
}

/** Chữ người gõ ở ô số xin xuất → chuỗi số máy đọc được. Tờ: chỉ số nguyên. Kg (`thapPhan`): kiểu
 *  Việt, phẩy là dấu lẻ, chấm chia nghìn ("1.500" là 1500 kg), tối đa 2 chữ số lẻ như máy chủ làm tròn. */
export function chuanSoGo(v: string, thapPhan: boolean): string {
  if (!thapPhan) return v.replace(/\D/g, "");
  const [nguyen, ...le] = v.replace(/[^\d,]/g, "").split(",");
  return le.length ? `${nguyen}.${le.join("").slice(0, 2)}` : nguyen;
}

/** Hiện lại số đang gõ: phần nguyên chia nghìn, kg giữ dấu phẩy lẻ dù chưa gõ chữ số lẻ (để gõ dở
 *  "395," không bị nuốt dấu). */
export function hienSoGo(so: string, thapPhan: boolean): string {
  if (so === "") return "";
  const [nguyen, le] = so.split(".");
  const chia = nguyen === "" ? "" : Number(nguyen).toLocaleString("vi-VN");
  return thapPhan && le !== undefined ? `${chia},${le}` : chia;
}

/** Kho thiếu bao nhiêu so với số xin (đơn vị của dòng khổ đang chọn) — null khi đủ / chưa chọn.
 *  Thiếu vẫn cho gửi. */
export function thieuTo(cg: GiaCongCapGiay, kho: string | null, so: number): number | null {
  const k = cg.kho.find((x) => `${x.kho_rong}x${x.kho_dai}` === kho);
  if (!k || !(so > 0) || k.ton >= so) return null;
  return so - k.ton;
}
