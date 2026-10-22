// Mô hình 1 BƯỚC routing đang được sửa trên màn (dùng chung bảng + drawer).
//
// Tách riêng khỏi cả hai để không vòng import, và để chỗ nào cũng nhìn cùng một hình dạng dòng.
// Mọi ô số giữ dạng CHUỖI: ô trống ("") khác 0 — trống nghĩa là "chưa khai, dùng gợi ý", còn 0 là
// người dùng cố tình khai bằng 0. Ép sang number quá sớm sẽ xoá mất sự khác nhau đó.
import { nhanTram, tenDonVi } from "./tenDonVi";
import type {
  LsxCongDoan,
  LsxCongDoanBody,
  LsxLoaiBuoc,
} from "../api/client";

/** DANH MỤC chứa món của một dòng vật tư ở bước: `"giay"` = NVL chính (người lập lệnh tự chọn từ
 *  danh mục Giấy, 08/09/2026), `"vat_tu"` = mực/kẽm/keo/màng. Id chỉ có nghĩa TRONG danh mục của
 *  nó ⇒ mọi chỗ so trùng/gom phải đi theo CẶP `(hang_loai, vat_tu_id)`. */
export type HangLoai = "giay" | "vat_tu";

/** Khoá CẶP của một món ở bước. Dùng nó ở MỌI chỗ so trùng / tra gợi ý / làm `key` React — so
 *  bằng `vat_tu_id` trần thì Giấy #7 và Vật tư #7 lẫn vào nhau, mà id trùng giữa hai danh mục là
 *  chuyện thường ngày. */
export function capMon(hang_loai: HangLoai | undefined, vat_tu_id: number): string {
  return `${hang_loai ?? "vat_tu"}:${vat_tu_id}`;
}

export interface EditRow {
  key: string;
  /** Id THẬT của bước ở server — null nếu bước mới thêm chưa lưu. Cần cho các cửa ghi ngoài
   *  routing (vd sổ giao–nhận), vì `key` chỉ là step_key. */
  id: number | null;
  cong_doan_id: number | null;
  ten: string;
  nhom: string | null;
  loai_buoc: LsxLoaiBuoc;
  /* `bat_buoc` GỠ khỏi form 07/09/2026: bước đã nằm trong routing thì PHẢI làm — không còn ô
     tick, không còn nhãn "tùy chọn", server cũng thôi nhận field này (xem migration 0275). */
  /* `la_kcs` GỠ (mg 0306, KCS theo lệnh): KCS không còn là một bước trong routing — người KCS kiểm
     bất kỳ công đoạn nào của lệnh từ màn KCS. */
  department_id: number | null;
  /** Tên tổ phụ trách server RESOLVE lúc đọc (kể cả khi `department_id` null vì lấy tổ mặc định của
   *  công đoạn). CHỈ ĐỌC — tổ khai ở danh mục Công đoạn, drawer chỉ bày lại, không cho đổi. */
  department_ten: string | null;
  may_id: number | null;
  /** Hai cờ dụng cụ đọc từ danh mục Công đoạn — CHỈ ĐỌC, không gửi lên. Chúng quyết định bước có
   *  hỏi khuôn không, và `tooling_type` là chiều lọc thứ hai của ô chọn dao.
   *  `khuon_be_id` là thứ người cấu hình lệnh chọn; bốn field còn lại là ảnh chụp để bày cho thợ. */
  requires_tooling: boolean;
  tooling_type: string | null;
  khuon_be_id: number | null;
  khuon_be_ma: string | null;
  khuon_be_ten: string | null;
  khuon_be_so_ke: string | null;
  khuon_be_tinh_trang: string | null;
  /** Ý ĐỊNH của sale về khuôn, chép từ phiếu tính giá lúc dựng lệnh — CHỈ ĐỌC. Không phải quyết
   *  định cuối (quyết định cuối là `khuon_be_id` do kế hoạch chốt); đứng cạnh nhau để so được. */
  khuon_nguon: "co_san" | "lam_moi" | null;
  khuon_phi: number;
  /** Câu nhắc khi ý định của sale lệch với con dao đã chốt — server dựng sẵn, `null` = không lệch.
   *  NHẮC chứ không chặn: máy không biết xưởng sẽ báo lại khách hay tự nuốt, nên để người quyết. */
  khuon_lech: string | null;
  // số lượng & hao hụt
  so_luong_vao: string;
  so_luong_ra: string;
  don_vi_vao: string;
  don_vi_ra: string;
  /** Bước có nằm trên DÒNG GIẤY không — CHỈ ĐỌC, server quyết theo cặp đơn vị của bước (bỏ trống
   *  cả hai = ngoài dòng giấy).
   *  `false` ⇒ số lượng không tự tính ngược, bù hao không cộng vào số giấy (drawer nói tại chỗ). */
  tren_dong_giay: boolean;
  /* `don_vi_san_luong` · `loi_quy_doi` · `san_luong_dien_giai` GỠ 18/09/2026 (mg `0324`) cùng
     công thức sản lượng ra của công đoạn — bước ngoài dòng giấy nay là số tự khai ở bước. */
  he_so_quy_doi: string;
  hao_hut: string;
  hao_hut_pct: string;
  so_luot_chay: string;
  // thời gian (phút)
  /** SỐ GIỜ KẾ HOẠCH của bước TỔ (18/09/2026, mg `0319`) — người lập lệnh gõ tay, mặc định 0, nhận
   *  số lẻ. Là TOÀN BỘ giờ chạy của bước tổ: tổ không còn năng suất hay kíp chuẩn nào để máy chia.
   *  Bước máy / thuê ngoài bỏ qua ô này (giờ đến từ máy). */
  so_gio_ke_hoach: string;
  /** Ô DUY NHẤT còn gõ được ở tab Thời gian ("Thời gian khác"). `setup_phut`/`chay_phut` kế thừa
   *  từ máy — số hiển thị lấy từ `thoi_luong_dien_giai` (server tính), không ô nào ghi ngược. */
  phat_sinh_phut: string;
  thoi_luong_dien_giai: Record<string, unknown>;
  /* `khoan_xem_truoc` (tiền công của bộ số đang sửa) GỠ 11/09/2026 — bước lệnh thôi hiện tiền.
     Phần GIỜ của `xem-truoc-buoc` vẫn dùng, nó vào thẳng `thoi_luong_dien_giai` ở trên. */
  /** Lượng tính sẵn cho mọi vật tư (server tính theo bước) — READ-ONLY, không gửi lên.
   *  `so_luong: null` = chưa tính được, `ly_do` nói vì sao và chỉ chỗ khai công thức. */
  vat_tu_goi_y: {
    hang_loai?: HangLoai;
    vat_tu_id: number;
    so_luong: number | null;
    dien_giai: string | null;
    ly_do: string | null;
    /** Giấy: khổ (mm) + đơn vị tờ nguyên gợi ý từ quy cách lệnh. */
    kho_rong?: number;
    kho_dai?: number;
    don_vi?: string;
    /** Giấy: đơn vị gốc suy từ ĐẦU VÀO của bước — `to` (tờ) hoặc đơn vị của mã (vd. `kg` khi bước
     *  nhận giấy khổ rộng). */
    don_vi_goc?: string;
  }[];
  /** Số tính lại theo danh mục HIỆN TẠI khi lệch số đã lưu — READ-ONLY, không gửi lên. */
  so_luong_vao_moi: number | null;
  so_luong_ra_moi: number | null;
  phu_thuoc_step_keys: string[];
  /** `tu_dong` = dòng MÁY bung từ tab Vật tư của CÔNG ĐOẠN ⇒ lần bung sau thay được. Người tự thêm
   *  hoặc đã sửa số thì về `false` và máy chừa ra — không thì đổi công đoạn là mất số vừa gõ. */
  vat_tus: { hang_loai: HangLoai; vat_tu_id: number; vat_tu_ma: string; vat_tu_ten: string;
             don_vi: string; so_luong: string; tu_dong: boolean;
             /** Vật tư khác giấy: người đã GÕ định mức ⇒ gửi kèm `so_luong`, máy không tính đè. */
             sua_tay?: boolean;
             /** Dòng GIẤY: khổ (mm) + đơn vị gốc do MÁY CHỦ dẫn xuất từ đầu vào của bước — chỉ đọc,
              *  không gửi. `don_vi_goc` rỗng = dòng vừa chọn, máy chủ chưa dẫn xuất. */
             kho_rong: string; kho_dai: string; don_vi_goc?: string;
             /** Vật tư KHÁC giấy: chip đã chép từ phiếu (gửi lại để máy tính định mức) + nhãn chip. */
             gia_tri_chip?: Record<string, number>;
             chips?: { ma: string; ten: string; don_vi?: string | null }[] }[];
  // Gia công ngoài (spec 2026-09-26): nhà gia công từ danh mục NCC + đơn giá cả lần.
  nha_cung_cap_id: number | null;
  /** Tên do máy chủ ghi — chỉ để hiện, không gửi lên. */
  nha_cung_cap: string;
  ghi_chu: string;
  /* Khối KHOÁN THEO ĐẦU VIỆC (`khoan_rate_id` · `khoan_chon_duoc` · `khoan_rate_id_luc_tai`) GỠ
     18/09/2026 (mg `0320`): bước thôi mang đầu việc. Việc khoán chọn LÚC GHI MẺ ở bàn tổ. */
}

/* `KhoanChon` (đầu việc chọn được ở bước, kèm năng suất + kíp + vật tư bung) GỠ 18/09/2026
   (mg `0320`) — vật tư bung thẳng theo CÔNG ĐOẠN, giờ tổ là số gõ tay. */


/** Điều kiện bắt đầu (§4.5) — "công đoạn trước xong" là mặc định nên không có ô riêng. */
let seq = 0;
type DongVatTu = EditRow["vat_tus"][number];

/** Dòng vật tư có số do MÁY tính (badge "Tự tính", không đếm vào "Đã sửa"). Giấy LUÔN là máy tính:
 *  số/khổ/dạng dẫn xuất từ đầu vào của bước ("Tờ theo đầu vào của bước"), không ai gõ — cờ
 *  `tu_dong` của dòng giấy chỉ nói dòng do ai thêm vào, không nói số do ai sửa. */
export function laMayTinh(v: Pick<DongVatTu, "hang_loai" | "sua_tay">): boolean {
  // Vật tư khác giấy: máy chủ luôn tính định mức từ công thức, trừ dòng người đã gõ tay.
  return v.hang_loai === "giay" || !v.sua_tay;
}

/** Dòng giấy vừa chọn, CHƯA lưu nên máy chủ chưa dẫn xuất khổ/đơn vị gốc/số — đừng hiện "chưa có
 *  công thức lượng" hay đơn vị giá (kg) của mã. */
export function giayChoLuu(v: Pick<DongVatTu, "hang_loai" | "don_vi_goc">): boolean {
  return v.hang_loai === "giay" && !v.don_vi_goc;
}

export function newKey(): string {
  // Bước MỚI mang sẵn step_key là UUID THẬT (không phải mã tạm "r…"). Lý do: khi chèn 1 bước
  // vào giữa DAG rồi bấm Lưu, bước SAU nó tham chiếu step_key này trong `phu_thuoc_step_keys`;
  // server khớp tiền nhiệm bằng step_key → phải là UUID có thật thì mới tra ra (mã "r5" tra ra
  // rỗng → lỗi "Không tìm thấy công đoạn tiền nhiệm"). Dev/prod luôn là ngữ cảnh bảo mật
  // (localhost/https) nên crypto.randomUUID luôn có; nhánh dự phòng chỉ để chắc TypeScript.
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  seq += 1;
  return `r${seq}`;
}

/** Số → chuỗi cho ô nhập. 0 và null đều thành "" để hiện GỢI Ý ở placeholder. */
function s(v: number | null | undefined): string {
  return v ? String(v) : "";
}

export function toEdit(cd: LsxCongDoan): EditRow {
  return {
    key: cd.step_key,
    id: cd.id ?? null,
    cong_doan_id: cd.cong_doan_id,
    ten: cd.ten,
    nhom: cd.nhom,
    loai_buoc: cd.loai_buoc,
    department_id: cd.department_id,
    department_ten: cd.department_ten ?? null,
    may_id: cd.may_id,
    requires_tooling: !!cd.requires_tooling,
    tooling_type: cd.tooling_type ?? null,
    khuon_be_id: cd.khuon_be_id ?? null,
    khuon_be_ma: cd.khuon_be_ma ?? null,
    khuon_be_ten: cd.khuon_be_ten ?? null,
    khuon_be_so_ke: cd.khuon_be_so_ke ?? null,
    khuon_be_tinh_trang: cd.khuon_be_tinh_trang ?? null,
    khuon_nguon: cd.khuon_nguon ?? null,
    khuon_phi: Number(cd.khuon_phi) || 0,
    khuon_lech: cd.khuon_lech ?? null,
    so_luong_vao: s(cd.so_luong_vao),
    so_luong_ra: s(cd.so_luong_ra),
    // ĐỂ TRỐNG là một CÂU TRẢ LỜI ("bước ngoài dòng giấy" — ghi kẽm, đóng thùng), không phải
    // "server chưa gửi": lấp bằng `"to"` là dán chữ "tờ" lên bước đếm bản kẽm. Chỉ nối vế RA theo
    // vế VÀO khi vế vào CÓ giá trị — bước không đổi cách đếm thì hai vế bằng nhau.
    don_vi_vao: cd.don_vi_vao || "",
    don_vi_ra: cd.don_vi_ra || cd.don_vi_vao || "",
    // Server cũ chưa gửi cờ ⇒ coi như TRÊN dòng giấy: im lặng đúng với hành vi trước đây, hơn là
    // đột nhiên dán chú giải "ngoài dòng giấy" lên mọi bước.
    tren_dong_giay: cd.tren_dong_giay !== false,
    he_so_quy_doi: s(cd.he_so_quy_doi),
    hao_hut: s(cd.hao_hut),
    hao_hut_pct: s(cd.hao_hut_pct),
    so_luot_chay: s(cd.so_luot_chay),
    // "0" chứ không "": ô mặc định HIỆN số 0 (chủ 18/09/2026 — "để mặc định là 0").
    so_gio_ke_hoach: String(Number(cd.so_gio_ke_hoach) || 0),
    phat_sinh_phut: s(cd.phat_sinh_phut),
    thoi_luong_dien_giai: cd.thoi_luong_dien_giai ?? {},
    vat_tu_goi_y: cd.vat_tu_goi_y ?? [],
    so_luong_vao_moi: cd.so_luong_vao_moi ?? null,
    so_luong_ra_moi: cd.so_luong_ra_moi ?? null,
    phu_thuoc_step_keys: cd.phu_thuoc_step_keys ?? [],
    vat_tus: (cd.vat_tus ?? []).map((v) => ({
      ...v, hang_loai: v.hang_loai ?? "vat_tu",
      so_luong: String(v.so_luong), tu_dong: Boolean(v.tu_dong), sua_tay: Boolean(v.sua_tay),
      kho_rong: v.kho_rong ? String(v.kho_rong) : "", kho_dai: v.kho_dai ? String(v.kho_dai) : "",
    })),
    nha_cung_cap_id: cd.nha_cung_cap_id ?? null,
    nha_cung_cap: cd.nha_cung_cap ?? "",
    ghi_chu: cd.ghi_chu ?? "",
  };
}

/** Tên HIỂN THỊ của một bước. Ưu tiên tên CÔNG ĐOẠN đang gắn (`cong_doan_id` → danh mục) rồi mới
 *  tới ô chữ tự do `ten`. Lý do: `ten` có thể còn giữ nhãn tạm "Công đoạn" của bước chèn tay để
 *  trống tên (client cũ đóng đinh literal đó; mg `0267` đã nắn dữ liệu cũ, `toBody` nay gửi
 *  trống); nếu `ten` không đồng bộ với công đoạn đang gắn (vd "Ghi kẽm CTP") thì nhãn trơ
 *  "Công đoạn" trong khi ô công đoạn đã đúng — tiêu đề/pill/bảng/DAG cùng gọi hàm này để không lệch.
 *  Công đoạn bị xoá khỏi danh mục (không tìm thấy ref) → lùi về `ten` như dropdown đang làm. */
export function tenBuoc(
  r: Pick<EditRow, "cong_doan_id" | "ten"> | null | undefined,
  congDoanRefs?: { id: number; ten: string }[] | null,
): string {
  if (!r) return "";
  if (r.cong_doan_id != null) {
    const cd = congDoanRefs?.find((c) => c.id === r.cong_doan_id);
    if (cd?.ten) return cd.ten;
  }
  return r.ten;
}

/** Máy MỜI cho một bước — cùng luật server (`may_to.may_chon_duoc`, spec máy thuộc tổ 22/10/2026):
 *    • công đoạn có bảng "Máy chạy được công đoạn này" (`mayChoPhep` = máy của các tổ đã tick) ⇒
 *      CHỈ những máy đó; chưa khai máy nào ⇒ mọi máy ("chưa khai = không chặn");
 *    • công đoạn có tick tổ (`coRangBuocTo`) và bước đã chọn tổ ⇒ chỉ máy THUỘC tổ đó.
 *  Hàng tick NHÓM máy gỡ khỏi luật — máy đi theo tổ.
 *
 *  Máy ĐANG gán luôn giữ lại dù rớt bộ lọc (dữ liệu cũ, hoặc vừa đổi tổ) — không thì mở lệnh cũ ra
 *  là ô máy trống trơn, người xếp lịch tưởng chưa ai gán. */
export function mayChonDuoc<T extends { id: number; toIds?: number[] | null; active?: boolean | null }>(
  mayRefs: T[],
  cd: { mayChoPhep?: number[] | null; coRangBuocTo?: boolean } | null | undefined,
  toId: number | null | undefined,
  mayDangGan: number | null | undefined,
): T[] {
  // Máy đã NGỪNG DÙNG ở danh mục thì không mời cho bước nữa — cùng lời hứa của hộp thoại
  // "Ngừng dùng". Nhưng máy bước ĐANG gán thì giữ nguyên trong danh sách: lọc thẳng ra là ô select
  // rơi về trống, người dùng tưởng chưa gán rồi lưu đè mất máy cũ.
  const con = mayRefs.filter((m) => m.active !== false || m.id === mayDangGan);
  const ds = cd?.mayChoPhep ?? null;
  if (!ds || ds.length === 0) return con;
  const theoId = new Map(con.map((m) => [m.id, m]));
  const loc = cd?.coRangBuocTo && toId != null;
  // Thứ tự theo bảng máy của công đoạn — máy "Đặt mặc định" đứng đầu.
  const ra = ds.map((id) => theoId.get(id)).filter((m): m is T =>
    m != null && (!loc || (m.toIds ?? []).includes(toId as number)));
  const dangGan = mayDangGan != null && !ra.some((m) => m.id === mayDangGan)
    ? theoId.get(mayDangGan) : undefined;
  return dangGan ? [...ra, dangGan] : ra;
}

/** MÁY MẶC ĐỊNH của công đoạn = máy còn dùng đứng ĐẦU bảng "Máy chạy được công đoạn này" — cùng luật
 *  server (`LsxService._may_mac_dinh`), cùng ý tổ đầu = tổ mặc định. Chưa khai máy ⇒ không có. */
export function mayMacDinh<T extends { id: number; active?: boolean | null }>(
  mayRefs: T[],
  cd: { mayChoPhep?: number[] | null } | null | undefined,
): number | null {
  for (const id of cd?.mayChoPhep ?? []) {
    if (mayRefs.some((m) => m.id === id && m.active !== false)) return id;
  }
  return null;
}

/** Máy điền sẵn khi bước đổi sang tổ `toId`: máy đầu bảng thuộc tổ đó (`may_to.may_mac_dinh`).
 *  Tổ chưa có máy chạy công đoạn này ⇒ null — bước trống máy, ô máy nói rõ vì sao. */
export function mayMacDinhCuaTo<T extends { id: number; toIds?: number[] | null; active?: boolean | null }>(
  mayRefs: T[],
  cd: { mayChoPhep?: number[] | null; coRangBuocTo?: boolean } | null | undefined,
  toId: number | null | undefined,
): number | null {
  if (!(cd?.mayChoPhep?.length)) return null;
  return mayChonDuoc(mayRefs, cd, toId, null)[0]?.id ?? null;
}

/** Tổ `toId` không có máy nào chạy được công đoạn (máy ĐANG gán cũng tính là máy của tổ nếu thuộc
 *  tổ) — ô máy nói "Tổ này chưa có máy chạy công đoạn này". Công đoạn không ràng buộc tổ hoặc chưa
 *  khai máy nào ⇒ false: không có gì để nói. */
export function toChuaCoMay<T extends { id: number; toIds?: number[] | null; active?: boolean | null }>(
  mayRefs: T[],
  cd: { mayChoPhep?: number[] | null; coRangBuocTo?: boolean } | null | undefined,
  toId: number | null | undefined,
): boolean {
  if (!cd?.coRangBuocTo || toId == null || !(cd.mayChoPhep?.length)) return false;
  return mayChonDuoc(mayRefs, cd, toId, null).length === 0;
}

export function emptyRow(): EditRow {
  return {
    key: newKey(), id: null, cong_doan_id: null, ten: "", nhom: null, loai_buoc: "may",
    department_id: null, department_ten: null, may_id: null,
    requires_tooling: false, tooling_type: null, khuon_be_id: null, khuon_be_ma: null,
    khuon_be_ten: null, khuon_be_so_ke: null, khuon_be_tinh_trang: null,
    khuon_nguon: null, khuon_phi: 0, khuon_lech: null,
    so_luong_vao: "", so_luong_ra: "", don_vi_vao: "to", don_vi_ra: "to",
    tren_dong_giay: true, he_so_quy_doi: "",
    hao_hut: "", hao_hut_pct: "", so_luot_chay: "",
    phat_sinh_phut: "", so_gio_ke_hoach: "0",
    thoi_luong_dien_giai: {},
    vat_tu_goi_y: [], so_luong_vao_moi: null, so_luong_ra_moi: null,
    phu_thuoc_step_keys: [], vat_tus: [],
    nha_cung_cap_id: null, nha_cung_cap: "",
    ghi_chu: "",
  };
}

/** Chèn `moi` vào vị trí `chen` của chuỗi bước và NỐI LẠI DÂY quanh chỗ chèn.
 *
 *  Vì sao phải có hàm này: sơ đồ DAG vẽ theo `phu_thuoc_step_keys`, còn số lượng/số hiệu bám
 *  `thu_tu` (thứ tự mảng) — hai thứ độc lập. Trước 09/09/2026 nút "Chèn trước/sau" chỉ `splice`
 *  một dòng rỗng vào mảng, nên số vẫn chảy đúng mà trên sơ đồ bước mới đứng trơ không dây, và cạnh
 *  cũ `trước → sau` vẫn nguyên. Server cũng không cứu được: nó chỉ tự nối chuỗi tuyến tính MỘT lần
 *  lúc tạo lệnh, còn `PUT /routing` ghi y nguyên cạnh client gửi.
 *
 *  Luật nối, cố ý KHÔNG bịa cạnh:
 *   · bước mới nhận bước liền trước làm tiền nhiệm (chèn lên đầu chuỗi thì không có tiền nhiệm);
 *   · bước liền sau ĐANG phụ thuộc bước liền trước thì cạnh đó đổi hướng qua bước mới — đúng nghĩa
 *     "nhét vào giữa"; các tiền nhiệm khác của nó (nhánh song song, cạnh xuyên LSX) giữ nguyên;
 *   · bước liền sau KHÔNG phụ thuộc bước liền trước (hai nhánh rời) thì để yên, bước mới chỉ treo
 *     vào bước trước. Tự nối đại một cạnh chưa từng có là sửa DAG sau lưng người dùng;
 *   · chèn lên ĐẦU chuỗi thì bước cũ đứng đầu nhận bước mới làm tiền nhiệm.
 */
export function chenBuoc(rows: EditRow[], chen: number, moi: EditRow): EditRow[] {
  const at = Math.max(0, Math.min(chen, rows.length));
  const truoc = at > 0 ? rows[at - 1] : null;
  const sau = at < rows.length ? rows[at] : null;
  const buocMoi: EditRow = { ...moi, phu_thuoc_step_keys: truoc ? [truoc.key] : [] };
  const next = rows.map((r) => {
    if (!sau || r.key !== sau.key) return r;
    if (!truoc) {
      return { ...r, phu_thuoc_step_keys: [buocMoi.key, ...r.phu_thuoc_step_keys] };
    }
    if (!r.phu_thuoc_step_keys.includes(truoc.key)) return r;
    return {
      ...r,
      phu_thuoc_step_keys: r.phu_thuoc_step_keys.map(
        (k) => (k === truoc.key ? buocMoi.key : k)),
    };
  });
  next.splice(at, 0, buocMoi);
  return next;
}

/** Bỏ bước ở vị trí `idx` và BẮC CẦU qua chỗ trống: ai đang phụ thuộc nó thì nhận thẳng các tiền
 *  nhiệm của nó.
 *
 *  Bắt buộc phải đi cùng `chenBuoc`: từ khi chèn có nối dây thật, xoá mà chỉ lọc dòng khỏi mảng sẽ
 *  để lại `step_key` mồ côi trong `phu_thuoc_step_keys` của bước sau — bấm Lưu là server bắn
 *  "Không tìm thấy công đoạn tiền nhiệm" (bước mới chưa từng có trong DB) hoặc "Không thể xóa bước
 *  đang được … phụ thuộc" (bước đã lưu, cạnh còn trong DB).
 */
export function boBuoc(rows: EditRow[], idx: number): EditRow[] {
  const bo = rows[idx];
  if (!bo) return rows;
  return rows
    .filter((_, i) => i !== idx)
    .map((r) => {
      if (!r.phu_thuoc_step_keys.includes(bo.key)) return r;
      const noi = r.phu_thuoc_step_keys.flatMap(
        (k) => (k === bo.key ? bo.phu_thuoc_step_keys : [k]));
      // `Set` khử trùng khi bước sau đã phụ thuộc SẴN một tiền nhiệm của bước bị bỏ; lọc `r.key`
      // chặn ca bắc cầu thành tự-phụ-thuộc (server coi đó là lỗi).
      return { ...r, phu_thuoc_step_keys: [...new Set(noi)].filter((k) => k !== r.key) };
    });
}

/** Dời một bước từ `from` sang `to` (nút ▲▼ / kéo thả) — lỗi #15, 18/10/2026.
 *
 * Bản cũ chỉ `splice` dòng, dây phụ thuộc giữ nguyên: Be thu lên trên Cán màng mà vẫn ghi tiền
 * nhiệm "Cán màng" đứng SAU nó, máy chủ tính chuỗi ngược theo thứ tự mới ra số sai. Nay:
 *  · tuyến THẲNG (mỗi bước chỉ phụ thuộc đúng bước liền trên trong bảng) ⇒ nối lại dây theo thứ
 *    tự mới, giữ các tiền nhiệm ngoài bảng (cạnh xuyên lệnh) ở sau;
 *  · tuyến rẽ nhánh ⇒ chỉ dời dòng — người lập lệnh tự sửa tab Phụ thuộc; máy chủ từ chối lưu
 *    nếu còn bước phụ thuộc bước đứng sau nó (`LsxService._kiem_tuyen_luu`). */
export function doiChoBuoc(rows: EditRow[], from: number, to: number): EditRow[] {
  if (to < 0 || to >= rows.length || from < 0 || from >= rows.length || from === to) return rows;
  const trong = new Set(rows.map((r) => r.key));
  const thang = rows.every((r, i) => {
    const dep = r.phu_thuoc_step_keys.filter((k) => trong.has(k));
    return i === 0 ? dep.length === 0 : dep.length === 1 && dep[0] === rows[i - 1].key;
  });
  const next = [...rows];
  const [row] = next.splice(from, 1);
  next.splice(to, 0, row);
  if (!thang) return next;
  return next.map((r, i) => {
    const ngoai = r.phu_thuoc_step_keys.filter((k) => !trong.has(k));
    return { ...r, phu_thuoc_step_keys: [...(i === 0 ? [] : [next[i - 1].key]), ...ngoai] };
  });
}

/** Lý do nút "Lưu công đoạn" bị khoá vì thiếu lý do đổi tuyến (§10, lỗi #15). `null` = lưu được.
 *  Tuyến khác bài tính giá mà không ghi lý do thì nhật ký chỉ còn "3 → 3 công đoạn", không ai đối
 *  chiếu lại được vì sao lệnh lệch phiếu. */
export function lyDoChanLuu(doiCauTruc: boolean, lyDo: string): string | null {
  return doiCauTruc && !lyDo.trim() ? "Ghi lý do đổi công đoạn rồi mới lưu được" : null;
}

export function n(v: string): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

/** Chuỗi rỗng → undefined (bỏ field khỏi payload) để server giữ mặc định thay vì ghi 0. */
function on(v: string): number | undefined {
  return v.trim() === "" ? undefined : n(v);
}

function ot(v: string): string | null {
  return v.trim() === "" ? null : v.trim();
}

export function toBody(rows: EditRow[]): LsxCongDoanBody[] {
  return rows.map((r, i) => {
    const ngoai = r.loai_buoc === "thue_ngoai";
    return {
      thu_tu: i,
      step_key: r.key.startsWith("r") ? undefined : r.key,
      cong_doan_id: r.cong_doan_id,
      // Tên TRỐNG thì gửi trống, ĐỪNG tự điền literal "Công đoạn": server có sẵn đường lùi
      // `ten or cd_obj.ten` (lấy tên danh mục của công đoạn đang gắn), điền literal ở đây làm
      // đường lùi đó không bao giờ chạy và đóng đinh chữ "Công đoạn" vào `lsx_cong_doan.ten` —
      // mọi màn đọc thẳng cột đó (sơ đồ bài ghép, chip phụ thuộc) sẽ trơ chữ này mãi.
      ten: r.ten.trim(),
      nhom: r.nhom,
      loai_buoc: r.loai_buoc,
      // KHÔNG gửi `bat_buoc` (07/09/2026): mọi bước trong routing đều bắt buộc, cột để server tự
      // giữ TRUE. Gửi lại chỉ mở đường ghi nhầm `false` trong khi drawer không còn ô sửa.
      // Để TRỐNG tổ → server tự lấy tổ mặc định của công đoạn (không ép khai lại).
      // Thuê ngoài không tổ, không máy, không vật tư — gửi rỗng để khỏi lệch với server.
      department_id: ngoai ? null : r.department_id,
      may_id: ngoai ? null : r.may_id,
      khuon_be_id: r.khuon_be_id,
      so_luong_vao: n(r.so_luong_vao),
      so_luong_ra: n(r.so_luong_ra),
      don_vi_vao: r.don_vi_vao,
      don_vi_ra: r.don_vi_ra,
      he_so_quy_doi: on(r.he_so_quy_doi),
      hao_hut: on(r.hao_hut),
      hao_hut_pct: on(r.hao_hut_pct),
      // Bước TỔ luôn 1 lượt (08/09/2026): ô đã gỡ khỏi drawer ở loại bước này, nên số cũ
      // khác 1 không được nằm lại vô hình. Server ghi đè 1 lần nữa ở `_ap_routing`.
      so_luot_chay: r.loai_buoc === "to" ? 1 : on(r.so_luot_chay),
      // Số giờ kế hoạch chỉ có nghĩa ở bước TỔ. Bước máy / thuê ngoài gửi 0 để số cũ (từ lúc bước
      // còn là tổ) không nằm lại vô hình trong DB. Ô trống = 0, không phải "giữ số cũ".
      so_gio_ke_hoach: r.loai_buoc === "to" ? Math.max(n(r.so_gio_ke_hoach), 0) : 0,
      // Ô trống = để máy tính từ năng suất (KHÔNG phải 0 phút).
      phat_sinh_phut: on(r.phat_sinh_phut),
      phu_thuoc_step_keys: r.phu_thuoc_step_keys,
      vat_tus: ngoai ? [] : r.vat_tus.map((v) => (v.hang_loai === "giay"
        // Giấy: chỉ chọn MÃ — số + khổ + đơn vị máy chủ tự ghi theo đầu vào của bước.
        ? { hang_loai: v.hang_loai, vat_tu_id: v.vat_tu_id, so_luong: null,
            tu_dong: v.tu_dong, kho_rong: 0, kho_dai: 0 }
        // Vật tư KHÁC: định mức do MÁY tính từ công thức + chip ⇒ không gửi so_luong — trừ dòng
        // người đã gõ định mức (`sua_tay`): gửi đúng số đó, máy chủ giữ nguyên.
        : v.sua_tay && v.so_luong.trim() !== "" && Number.isFinite(Number(v.so_luong))
          ? { hang_loai: v.hang_loai, vat_tu_id: v.vat_tu_id, tu_dong: false, sua_tay: true,
              so_luong: Number(v.so_luong), gia_tri_chip: v.gia_tri_chip ?? {} }
          : { hang_loai: v.hang_loai, vat_tu_id: v.vat_tu_id, tu_dong: v.tu_dong,
              gia_tri_chip: v.gia_tri_chip ?? {} })),
      // Chỉ gửi khi bước ĐANG là thuê ngoài — đổi loại rồi thì server tự dọn (Task 3).
      nha_cung_cap_id: ngoai ? r.nha_cung_cap_id : null,
      ghi_chu: ot(r.ghi_chu),
      // `piece_rate_id` GỠ 18/09/2026 (mg `0320`) — bước thôi ghim đầu việc khoán.
    };
  });
}

/** Lỗi/nghi vấn của RIÊNG 1 dòng routing — chỉ TÔ MÀU, không chặn lưu.
 *
 * Ở đây (chứ không ở `LsxRoutingTable`) vì nó thuần `EditRow` → chuỗi, không dính React: cùng chỗ
 * với `toEdit`/`toBody`/`thoiLuong`, và test được mà không phải dựng cả bảng.
 *
 *
 * Cảnh báo giả nguy hiểm hơn là không có cảnh báo: nó dạy người dùng bỏ qua cả cột, nên lúc đứt
 * thật cũng chẳng ai nhìn.
 *
 * Nay lọc bằng CỜ `tren_dong_giay` — server chấm sẵn, FE không tự đoán từ mã. Bước ngoài dòng giấy
 * đo khối lượng việc của RIÊNG nó (kẽm đếm bản, đóng thùng đếm thùng);
 * đem thước đó so với thước dòng giấy là so hai thứ không liên quan.
 *
 * Vẫn so bằng MÃ đơn vị chứ không bằng trạm: giữa hai bước liền nhau trên dòng giấy, giấy không
 * đổi cách đếm — mọi nhịp đổi trạm (`tờ → tay`) xảy ra BÊN TRONG một bước, giữa `vào` và `ra` của
 * chính nó. Bởi vậy luật cầu giữa các trạm (`CAU_TRAM`) không cần có mặt ở client, và KHÔNG được
 * chép sang đây — xem bài học ở `donViChuoi` phía dưới.
 */
export function loiDong(rows: EditRow[], i: number): string[] {
  const r = rows[i];
  const out: string[] = [];
  const vao = n(r.so_luong_vao);
  const ra = n(r.so_luong_ra);
  if (r.don_vi_vao === r.don_vi_ra && vao > 0 && ra > vao) out.push("ra nhiều hơn vào");
  // KHÔNG kiểm `he_so <= 1` nữa: hệ số nay do server suy, và 1 là HỢP LỆ ở cả hai cầu
  // (1 tờ nguyên ra 1 tờ in là chuyện thường). Luật cũ bắt oan đúng ca đó.
  // Thuê ngoài không có tổ / máy — đòi nhà gia công chọn từ danh mục NCC (26/09/2026).
  if (r.loai_buoc === "thue_ngoai") {
    if (r.nha_cung_cap_id == null) out.push("chưa chọn nhà gia công");
  } else if (r.department_id == null && r.may_id == null) out.push("chưa gán tổ / máy");
  if (r.tren_dong_giay && r.don_vi_vao) {
    const truoc = rows
      .slice(0, i)
      .reverse()
      .find((x) => x.tren_dong_giay && x.don_vi_vao && x.don_vi_ra);
    if (truoc && truoc.don_vi_ra !== r.don_vi_vao) out.push("đứt đơn vị");
  }
  if (i > 0 && r.ten && rows[i - 1].ten === r.ten) out.push("trùng bước trước");
  return out;
}

/** Preview tức thời trong drawer trước khi lưu.
 *
 * Backend vẫn tính lại và chốt snapshot khi lưu. Bản preview này dùng đúng các đầu vào đang hiện
 * trên form để người lập kế hoạch không phải lưu mù rồi mở lại mới biết thời gian thay đổi ra sao.
 */
export interface MayTinhGio {
  tocDo?: number | null;
  tocDoMin?: number | null;
  tocDoMax?: number | null;
  donViTocDo?: string | null;
  chuanBiPhut?: number | null;
  chuanBiKhoan?: { ten?: string; phut?: number }[];
}

/** Bộ số TỐI THIỂU để tính lại thời lượng. `EditRow` của bước lệnh khớp sẵn; bước chung của bài
 *  ghép dựng được từ dữ liệu của nó. Nới kiểu ở đây để HAI màn xài CHUNG một công thức, thay vì
 *  màn bài ghép chép phép tính lần thứ hai (hai bản công thức = hai đường lệch nhau lúc sửa). */
export type ThoiLuongInput = Pick<
  EditRow,
  | "loai_buoc"
  | "so_luot_chay"
  | "so_gio_ke_hoach"
  | "phat_sinh_phut"
  | "thoi_luong_dien_giai"
  | "don_vi_vao"
  | "so_luong_vao"
> & {
  /** Có để phân biệt "chưa gán máy" với "quy đổi tịt" trong câu cảnh báo — hai lỗi khác chỗ khai.
   *  Optional để bước chung của bài ghép (dựng object bằng tay) không phải khai thêm; vắng thì câu
   *  cảnh báo giữ nguyên như cũ. */
  may_id?: number | null;
};

export function thoiLuongLive(r: ThoiLuongInput, may?: MayTinhGio | null): Record<string, unknown> {
  const f = (v: string | number | null | undefined): number => {
    const x = Number(v ?? 0);
    return Number.isFinite(x) ? x : 0;
  };
  const tron = (v: number): number => Math.round(v * 100) / 100;
  const dgServer = (r.thoi_luong_dien_giai ?? {}) as Record<string, unknown>;
  // SL đưa vào phép chia là số ĐÃ QUY ĐỔI về đơn vị của tốc độ — server tính (chỉ nó có bảng cặp
  // quy đổi) rồi gửi kèm trong `thoi_luong_dien_giai.so_luong_vao`. Bản preview KHÔNG dựng lại
  // phép quy đổi: công thức thì được phép có hai bản, bảng quy đổi thì không.
  const daQuyDoi = dgServer.phuong_phap !== "chua_quy_doi" && dgServer.so_luong_vao != null;
  const vao = daQuyDoi ? Number(dgServer.so_luong_vao) || 0 : 0;
  const luot = r.loai_buoc === "to" ? 1 : Math.max(Math.trunc(f(r.so_luot_chay)) || 1, 1);
  const canhBao: string[] = [];

  // Số của MÁY ĐANG CHỌN trên form (`may`) — KHÔNG đợi server. Đổi máy trong drawer là chuẩn bị
  // + thời gian chạy phải nhảy ngay; chỉ khi bấm Lưu mới ghi DB. Không truyền `may` (bảng chưa
  // nạp xong danh mục) thì rơi về diễn giải server đã trả — vẫn hơn là ra 0.
  const numOf = (k: string): number => Number(dgServer[k] ?? 0) || 0;
  const coMay = may != null;
  // THUÊ NGOÀI đi CHUNG đường bước máy: nhà thầu là một máy trong danh mục (tên kèm hậu tố
  // "thuê ngoài – …"), nên chuẩn bị + tốc độ + số lượt lấy từ máy đó. Bỏ nó ra ngoài như bản
  // trước thì mọi bước thuê ngoài ra 0′ mà KHÔNG có lời cảnh báo nào — im lặng, khó thấy nhất.
  const theoMay = r.loai_buoc !== "to";
  const setup = coMay ? (theoMay ? f(may?.chuanBiPhut) : 0) : numOf("setup_phut");
  const khac = f(r.phat_sinh_phut);
  const khoanChuanBi = coMay
    ? (theoMay ? (may?.chuanBiKhoan ?? []) : [])
    : (Array.isArray(dgServer.chuan_bi_khoan) ? dgServer.chuan_bi_khoan : []);

  let phuongPhap: string = theoMay ? "may" : r.loai_buoc;
  let nangSuatCoSo = 0;       // tốc độ máy (bước tổ không có năng suất nào nữa — mg `0321`)
  let nangSuatHieuDung = 0;
  let chay = 0;
  let chayNhanh = 0;
  let chayCham = 0;

  if (r.loai_buoc === "to") {
    // Bước TỔ = SỐ GIỜ KẾ HOẠCH người lập lệnh gõ × 60 (18/09/2026, §5.1) — cùng phép với
    // `thoi_luong_buoc` ở server. Một con số gõ tay: ba mức bằng nhau, 0 giờ là HỢP LỆ, không cảnh báo.
    chay = chayNhanh = chayCham = Math.max(f(r.so_gio_ke_hoach), 0) * 60;
  } else {
    // Công thức chốt 2026-08-04: SL vào × 60 ÷ tốc độ × số lượt.
    const tocDo = coMay ? f(may?.tocDo) : numOf("toc_do");
    const tocDoMax = coMay ? f(may?.tocDoMax) : numOf("toc_do_max");
    const tocDoMin = coMay ? f(may?.tocDoMin) : numOf("toc_do_min");
    const chayVoi = (v: number): number => (v > 0 && vao > 0 ? (vao * 60) / v * luot : 0);
    nangSuatCoSo = tocDo;
    nangSuatHieuDung = tocDo;
    chay = chayVoi(tocDo);
    chayNhanh = tocDoMax > 0 ? chayVoi(tocDoMax) : chay;   // tốc độ TỐI ĐA ⇒ thời lượng nhỏ nhất
    chayCham = tocDoMin > 0 ? chayVoi(tocDoMin) : chay;
    if (tocDo <= 0) phuongPhap = "thieu_nang_suat";
  }
  // Chưa quy đổi được SL vào sang đơn vị tốc độ ⇒ không có giờ chạy, và nói đúng chỗ phải đi khai.
  // Thắng mọi lý do khác: có tốc độ mà không biết bước nhận bao nhiêu THEO ĐƠN VỊ ĐÓ thì phép chia
  // vô nghĩa (chủ 15/08/2026 — ca `500 kg/h` nhận số tờ).
  // Bước tổ không quy đổi gì (giờ là số gõ tay) — nhánh này chỉ dành cho máy / thuê ngoài.
  if (!daQuyDoi && theoMay) {
    phuongPhap = "chua_quy_doi";
    chay = chayNhanh = chayCham = 0;
    // CHƯA GÁN MÁY nói câu khác: bước máy trống máy thì server không có ĐÍCH nào để quy về — cách
    // đo giờ chạy lẫn tốc độ đều treo ở cặp (công đoạn × máy). Câu "chưa quy đổi" ở ca này chỉ
    // người ta sang Đơn vị & quy đổi, khai xong cũng không cứu được gì. Mã `phuong_phap` vẫn giữ
    // `chua_quy_doi` — xếp lịch phân nhánh theo mã đó, chỉ CÂU cần đổi. `may_id === undefined`
    // (bài ghép không truyền) coi như không biết ⇒ giữ câu cũ.
    canhBao.push(
      theoMay && r.may_id === null
        ? "Bước chưa gán máy nên chưa biết chạy trên máy nào — chọn máy ở tab Phân công & Thiết bị. "
          + "Cách đo giờ chạy và tốc độ đều khai theo cặp (công đoạn × máy)."
        // Cùng câu với server — xem chú thích ở `thoi_luong_buoc` vì sao không chỉ về Đơn vị & quy đổi.
        : "Chưa đổi được số lượng vào sang đơn vị tốc độ của máy nên không tính được thời gian chạy. "
          + "Khai ô \"Cách đo giờ chạy\" của máy này ở Cấu hình danh mục → Công đoạn → bảng máy của công đoạn."
    );
  } else if (phuongPhap === "thieu_nang_suat") {
    canhBao.push("Máy đang gán chưa khai tốc độ (hoặc bước chưa gán máy) nên không tính được thời gian chạy.");
  }

  const chiemTaiNguyen = khac + setup + chay;
  return {
    phuong_phap: phuongPhap,
    // Số + đơn vị ĐÃ QUY ĐỔI (thứ thật sự đem chia); số/đơn vị gốc của bước đi kèm để câu diễn
    // giải nói được cả hai chặng — cùng hình dạng server trả.
    so_luong_vao: tron(vao),
    don_vi_vao: (dgServer.don_vi_vao as string | null) ?? r.don_vi_vao,
    so_luong_vao_goc: dgServer.so_luong_vao_goc ?? f(r.so_luong_vao),
    don_vi_vao_goc: (dgServer.don_vi_vao_goc as string | null) ?? r.don_vi_vao,
    quy_doi_dien_giai: dgServer.quy_doi_dien_giai ?? null,
    nguon_nang_suat: r.loai_buoc === "to" ? "gio_ke_hoach" : "may",
    nang_suat_co_so: nangSuatCoSo > 0 ? tron(nangSuatCoSo) : null,
    nang_suat_hieu_dung: nangSuatHieuDung > 0 ? tron(nangSuatHieuDung) : null,
    // Bước tổ vẫn BÁO số lượt — chip `so_luot_chay` của công thức tiền công cần số thật — nhưng
    // từ 08/09/2026 số đó luôn là 1: ô nhập chỉ còn ở bước máy/thuê ngoài.
    so_luot_chay: luot,
    so_gio_ke_hoach: r.loai_buoc === "to" ? tron(Math.max(f(r.so_gio_ke_hoach), 0)) : 0,
    setup_phut: tron(setup),
    chuan_bi_khoan: khoanChuanBi,
    phat_sinh_phut: tron(khac),
    chay_phut: tron(chay),
    chay_phut_min: tron(chayNhanh),
    chay_phut_max: tron(chayCham),
    toc_do: coMay ? (may?.tocDo ?? null) : (dgServer.toc_do ?? null),
    toc_do_min: coMay ? (may?.tocDoMin ?? null) : (dgServer.toc_do_min ?? null),
    toc_do_max: coMay ? (may?.tocDoMax ?? null) : (dgServer.toc_do_max ?? null),
    co_dai_toc_do: tron(chayNhanh) !== tron(chayCham),
    chiem_tai_nguyen_phut: tron(chiemTaiNguyen),
    // Chờ kỹ thuật GỠ 13/08/2026 ⇒ tổng bằng đúng phần chiếm tài nguyên.
    tong_phut: tron(chiemTaiNguyen),
    canh_bao: canhBao,
  };
}

/** Thời lượng bước cho bảng/thẻ. `chiemMin`/`chiemMax` = cùng công thức với tốc độ tối đa /
 *  tối thiểu của máy; máy chưa khai dải thì cả ba bằng nhau (`coDai` = false). */
export function thoiLuong(r: EditRow, may?: MayTinhGio | null): {
  chay: number; chiemMay: number; tong: number;
  chiemMin: number; chiemMax: number; coDai: boolean;
} {
  const d = thoiLuongLive(r, may);
  const co_dinh = Number(d.phat_sinh_phut ?? 0) + Number(d.setup_phut ?? 0);
  return {
    chay: Number(d.chay_phut ?? 0),
    chiemMay: Number(d.chiem_tai_nguyen_phut ?? 0),
    tong: Number(d.tong_phut ?? 0),
    chiemMin: co_dinh + Number(d.chay_phut_min ?? d.chay_phut ?? 0),
    chiemMax: co_dinh + Number(d.chay_phut_max ?? d.chay_phut ?? 0),
    coDai: Boolean(d.co_dai_toc_do),
  };
}

/** "2 giờ 4 phút" — đọc nhanh hơn "124 phút" khi bước dài.
 *
 *  CỐ TÌNH dừng ở GIỜ, không quy ra ngày: "ngày" ở đây sẽ là ngày lịch (24h) trong khi dải tổng
 *  quy ra NGÀY LÀM VIỆC (8h) — hai con số cạnh nhau mà khác gốc thì đọc thành mâu thuẫn
 *  ("10 ngày 8 giờ ≈ 31 ngày làm việc"). Một đơn vị duy nhất, ai cũng hiểu đúng. */
export function phut(v: number): string {
  const m = Math.round(v);
  if (m <= 0) return "—";
  if (m < 60) return `${m} phút`;
  const gio = Math.floor(m / 60);
  const du = m % 60;
  return du ? `${gio} giờ ${du} phút` : `${gio} giờ`;
}

/** Mã đơn vị → TÊN trong danh mục (`kg` → "kg", `thung` → "thùng"). Chưa nạp xong / mã lạ ⇒ trả mã
 *  trần. Không còn bảng nhãn cứng — xem `tenDonVi.ts`.
 *
 *  Dùng cho ĐƠN VỊ THẬT: vật tư, kho, ĐVT sản phẩm, đơn giá khoán. Cột `don_vi_vao`/`don_vi_ra`
 *  của công đoạn / bước / công việc tổ KHÔNG đi qua đây — chúng giữ mã CHẶNG, dùng `nhanChang`. */
export function nhanDonVi(dv: string | null | undefined): string {
  return dv ? tenDonVi(dv) ?? dv : "";
}

/** Mã CHẶNG dòng giấy → nhãn ("to" → "tờ in", "cai" → "thành phẩm"). Cho mọi cột kế thừa
 *  `cong_doan.don_vi_vao/ra`: bước lệnh · bước bài ghép · công việc tổ · chuỗi bù hao phiếu tính giá.
 *
 *  Vì sao KHÔNG gộp thẳng vào `nhanDonVi`: `to · con · tay · cai` cũng là mã đơn vị THẬT trong danh
 *  mục (đơn giá khoán đ/tờ, vật tư bán theo cái). Đổi nhãn ở đó thì "70 đ/cái" hoá "70 đ/thành phẩm".
 *  Hai từ vựng trùng chuỗi mã, phải tách ở nơi gọi — xem `tenDonVi.ts`.
 *
 *  Mã không phải chặng thì RƠI VỀ danh mục đơn vị: bước ngoài dòng giấy (ghi kẽm, đóng thùng) và
 *  dữ liệu trước 06/09/2026 vẫn giữ mã đơn vị thật ở hai cột này. */
export function nhanChang(dv: string | null | undefined): string {
  return dv ? nhanTram(dv) ?? nhanDonVi(dv) : "";
}

/** Như `nhanChang`, nhưng chặng THÀNH PHẨM gọi bằng đơn vị tính của sản phẩm trên lệnh (`dvt`, vd
 *  "cuốn") — bước cuối của lệnh chính luôn ra chặng này (11/10/2026). Không có `dvt` thì như cũ. */
export function nhanChangLenh(dv: string | null | undefined, dvt: string | null | undefined): string {
  return dvt && (dv ?? "").trim().toLowerCase() === "cai" ? dvt : nhanChang(dv);
}

export interface DonViChuoi {
  /** Chặng TỜ IN — thứ bước in đếm. */
  to: string;
  /** Chặng THÀNH PHẨM — đầu ra của bước đổi mức cuối. */
  tp: string;
  /** Chặng GIỮA (tay sách) — chỉ có khi chuỗi đổi mức từ 2 lần trở lên. "" = không có. */
  tay: string;
  /** Chặng TỜ NGUYÊN. Routing KHÔNG có bước xả giấy ⇒ lùi về nhãn "tờ nguyên", KHÔNG mượn chữ
   *  "tờ in" (giấy nguyên lấy kho không phải tờ in). */
  toNguyen: string;
}

/** Hình dạng SERVER gửi mã bốn chặng — `LsxDetail` và mỗi dòng "lệnh dự kiến" đều có bộ này. */
export interface MaDonViChuoi {
  don_vi_to?: string | null;
  don_vi_tp?: string | null;
  don_vi_tay?: string | null;
  don_vi_to_nguyen?: string | null;
}

/** Nhãn dự phòng chặng tờ nguyên khi danh mục chặng chưa nạp / routing không có bước xả. */
const NHAN_TO_NGUYEN = "tờ nguyên";

/** Sau thao tác của CHÍNH MÌNH (lưu, đổi trạng thái…) máy chủ broadcast SSE; client gộp nhịp 400 ms nên
 *  tick về SAU khi dữ liệu trả về. Tick nhảy trong cửa sổ này sau thao tác của mình là của mình. */
export const CUA_SO_TU_LAM_MS = 3000;

/** Banner "Có thay đổi mới" có hiện không? `tuLamLuc` = mốc (ms) thao tác thành công gần nhất của chính
 *  người dùng, 0 = chưa có. Tick vượt mốc đã xem mà rơi trong cửa sổ sau thao tác của mình ⇒ KHÔNG báo;
 *  người khác đổi (ngoài cửa sổ) vẫn báo. */
export function tickConLaCuaNguoiKhac(eventTick: number, daXem: number, tuLamLuc: number, now: number): boolean {
  if (eventTick <= daXem) return false;
  return !(tuLamLuc > 0 && now - tuLamLuc <= CUA_SO_TU_LAM_MS);
}

/** MÃ bốn chặng (server) → TÊN bốn chặng (danh mục).
 *
 *  LUẬT SUY CHẶNG NẰM Ở SERVER, đúng một bản: `services/dong_giay.don_vi_chuoi`. Hàm này chỉ dịch
 *  mã sang tên. Trước 12/08/2026 frontend giữ bản chép tay thứ hai của cùng luật đó — và cả hai
 *  bản đã CÙNG SAI y hệt nhau ở chặng "tay" (lấy bước đổi mức đầu tiên, vốn là bước xả giấy chứ
 *  không phải bước gấp). Hai bản cùng luật không giúp bắt lỗi, chỉ nhân đôi chỗ phải sửa.
 *
 *  Hai lối lùi ở đây là DẪN XUẤT chứ không phải nhãn bịa:
 *   · `tp` rỗng → ĐVT của chính sản phẩm (người dùng khai ở đơn/phiếu).
 *   · `toNguyen` rỗng → "tờ nguyên" (nhãn chặng): routing không có bước xả thì SỐ vẫn bằng số tờ in,
 *     nhưng nó là GIẤY NGUYÊN lấy kho — gọi "tờ in" là sai tên (#66, 19/10/2026).
 *  Ngoài hai lối đó, chặng nào server không nói thì trả RỖNG — nơi gọi hiện mỗi con số. Nhãn khối
 *  đã nói CHẶNG ("Vào máy" · "Giấy nguyên") nên rỗng cũng không mất nghĩa.
 */
export function donViChuoi(src: MaDonViChuoi, dvSanPham?: string | null): DonViChuoi {
  const to = nhanChang(src.don_vi_to);
  return {
    to,
    tp: nhanChang(src.don_vi_tp) || dvSanPham || "",
    tay: nhanChang(src.don_vi_tay),
    toNguyen: nhanChang(src.don_vi_to_nguyen) || nhanTram("to_nguyen") || NHAN_TO_NGUYEN,
  };
}

/** Câu quy đổi của MỘT bước: `"10 Tờ in = 1 Thành phẩm"`. `null` khi bước không đổi đơn vị.
 *
 *  LẬT LẠI khi hệ số < 1 — đó là ca SÁCH GẤP TAY (10 tờ mới gom thành 1 cuốn → hệ số 0,1). Viết
 *  thẳng `"1 Tờ in = 0,1 Thành phẩm"` thì đúng số nhưng người đọc phải tự nghịch đảo trong đầu.
 *  Bên Tính giá đã lật từ lâu; đây là bản DÙNG CHUNG để bốn màn (tính giá · bảng routing · drawer
 *  bước · thẻ bước chung bài ghép) không mỗi nơi một kiểu. */
export function heSoChu(
  heSo: number | null | undefined,
  dvVao: string | null | undefined,
  dvRa: string | null | undefined,
): string | null {
  const hs = Number(heSo);
  if (!dvVao || !dvRa || dvVao === dvRa || !Number.isFinite(hs) || hs === 1 || hs <= 0) return null;
  const so = (v: number) => v.toLocaleString("vi-VN", { maximumFractionDigits: 4 });
  return hs < 1
    ? `${so(1 / hs)} ${nhanChang(dvVao)} = 1 ${nhanChang(dvRa)}`
    : `1 ${nhanChang(dvVao)} = ${so(hs)} ${nhanChang(dvRa)}`;
}

/** Nhãn trong bộ chọn giấy của một bước — theo ĐẦU VÀO của bước (spec 2026-10-01
 *  dong-giay-theo-dau-vao §4): bước nhận tờ in ⇒ "tờ in", nhận tờ nguyên ⇒ "tờ nguyên", còn lại
 *  (nhận giấy khổ rộng, đếm theo đơn vị của mã) ⇒ "khổ 1000 mm (kg)" (chưa biết khổ thì chỉ đơn
 *  vị). `donViMa` đã là nhãn hiển thị (qua `nhanDonVi`). 10/10/2026 giấy bỏ dạng cuộn/tờ: không
 *  còn chữ "cuộn". */
export function nhanGiayTheoDauVao(
  donViVao: string | null | undefined,
  donViMa: string,
  khoRong?: number | null,
): string {
  if (!donViVao) return ""; // chưa khai đơn vị vào ⇒ chưa biết đếm tờ hay theo đơn vị mã: chỉ hiện tên
  if (donViVao === "to") return "tờ in";
  if (donViVao === "to_nguyen") return "tờ nguyên";
  if (donViVao === "con" || donViVao === "cai" || donViVao === "tay") return ""; // đầu vào không phải giấy
  return khoRong ? `khổ ${khoRong} mm (${donViMa})` : donViMa;
}
