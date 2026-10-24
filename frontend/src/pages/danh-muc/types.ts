// Hợp đồng KHAI BÁO của màn danh mục dùng chung — một `CatalogConfig` mô tả trọn một màn.
//
// File này CHỈ được import `type ReactNode`. Mọi thứ khác trong `danh-muc/` đều trỏ về đây, nên
// hễ nó import ngược lại một component là cả cây thành vòng tròn (module rỗng lúc chạy, lỗi kiểu
// "Cannot access '...' before initialization" — rất khó lần).
import type { ReactNode } from "react";

export type Option = { value: string; label: string };
export type OptionsField = Option[] | (() => Option[]);

export interface FieldDef {
  key: string;
  label: string;
  // `ref-search-ma` = như `ref-search` nhưng lưu MÃ (chuỗi) thay vì id — cho cột trỏ danh mục bằng
  // mã như `don_vi_gia` (quy đổi làm việc trên mã `kg`/`to`, không trên id).
  // `don-vi-them` = mảng MÃ đơn vị khai thêm cạnh ĐVT chính (Giấy · Vật tư khác, `ODonViNhieu`):
  // `refPrefix` trỏ danh mục Đơn vị, `donViChinh` là ô ĐVT chính cùng form.
  type?: "text" | "number" | "date" | "select" | "checkbox" | "ref" | "ref-multi" | "ref-search" | "ref-search-ma" | "bands" | "nhom_may" | "nhom_may-multi" | "formula" | "vat-tu-cong-doan" | "vat-tu-chip" | "chuan_bi_khoan" | "lich_bao_tri" | "don_vi_toc_do" | "may-cua-cong-doan" | "viec-phat-sinh" | "khoan-cong-doan" | "to-multi" | "don-vi-them";
  /** Ô `select`: danh sách chọn. Nhận cả HÀM (như `hint`/`an`) cho menu mà nhãn đến MUỘN hơn
   *  lúc khai config — 5 chặng dòng giấy nạp từ `/api/don-vi/tram`, mảng dựng sẵn ở tầm module sẽ
   *  đóng băng lúc bảng còn rỗng. Hàm được gọi MỖI lần vẽ, nên vẽ lại là menu tự đầy. */
  options?: OptionsField;
  /** Ô `select`: nhãn của các mã ĐÃ GỠ khỏi `options` nhưng dữ liệu cũ còn mang. Dòng đang giữ mã
   *  đó vẫn thấy đúng chữ (kèm "đã gỡ") thay vì ô trống, và lưu lại không làm mất giá trị. */
  nhanCu?: Record<string, string>;
  /** Ô `formula`: ÉP bộ chip theo loại này thay vì suy từ màn. Cần khi MỘT màn có hai ô công thức
   *  hỏi hai câu khác nhau — "Công thức tính giá" (ra tiền) vs "Công thức tính lượng" (ra lượng,
   *  cần chip `sl_vao`/`sl_ra`, không cần chip đơn giá). */
  loaiO?: string;
  /** Ô `formula`: NHÃN của tab công thức chứa ô này. Cho phép MỘT màn tách nhiều tab công thức
   *  riêng — vd một màn có hai ô công thức (giá · lượng) thì mỗi ô vào một tab riêng. Ô công thức KHÔNG khai `nhanTab` rơi vào tab mặc định (nhãn
   *  `config.nhanTabCongThuc`, mặc định "Công thức tính giá") — nên màn 1 tab như cũ giữ nguyên. */
  nhanTab?: string;
  /** Ô `formula`: tên field MẢNG chip của CHÍNH form này (kiểu `vat-tu-chip`); chip đó thành biến
   *  bổ sung của ô (chip riêng của vật tư — không nằm trong từ điển hệ thống). */
  chipsTu?: string;
  /** Ô `formula`: mã biến CẦN ẨN khỏi bảng chip của riêng Ô NÀY, dù `loaiO` cho phép — biến vẫn
   *  hợp lệ nếu gõ tay/đã lưu, chỉ không hiện chip bấm-để-chèn. Dùng khi có chip khác đúng hơn cho
   *  ngữ cảnh của ô (vd `to_dau_vao`/`to_sau_in` là số CẢ CHUỖI, còn `sl_vao`/`sl_ra` là số của
   *  CHÍNH BƯỚC — xem `bien_cong_thuc.py`).
   *
   *  Nhận cả HÀM theo form đang gõ (như `hint`): có chip chỉ đúng với MỘT SỐ dòng trong cùng màn —
   *  (hiện chưa ô nào dùng dạng hàm — chip khuôn ép kim đã gỡ 01/10/2026). */
  an?: string[] | ((form: Record<string, unknown>) => string[]);
  /** Ô `to-multi`: nhãn gắn sau chip tổ ĐẦU danh sách đang chọn (vd "mặc định") — công đoạn nhiều
   *  tổ lấy tổ chọn đầu làm tổ mặc định của bước lệnh, không đánh dấu thì không ai biết. */
  nhanDau?: string;
  /** Ô `don-vi-them`: key của ô ĐVT chính cùng form (mặc định `don_vi_gia`) — nhóm quy đổi của nó
   *  bị ẩn khỏi danh sách thêm. */
  donViChinh?: string;
  refPrefix?: string;           // ref / ref-multi / ref-search: endpoint danh mục nguồn (đổ theo TÊN/MÃ)
  /** `don-vi-them`: mã đơn vị không bỏ được (Giấy: tờ + kg, 18/10/2026). */
  donViBatBuoc?: string[];
  /** Query thêm khi nạp danh mục nguồn, vd `{ active: true }` — không lọc thì picker mời cả dòng
   *  đã ngừng dùng, người ta chọn xong bấm Lưu mới ăn lỗi từ server. */
  refParams?: Record<string, unknown>;
  required?: boolean;
  /** Chuỗi tĩnh, HOẶC hàm dựng câu từ chính form đang gõ — vd quy cách đóng gói hiện
   *  "1 thùng = 3 kg" ghép từ ô đơn vị đóng gói + ô hệ số + ĐVT. Câu đọc được kiểm bằng mắt
   *  ngay lúc khai, đỡ hơn hẳn hai ô số rời không nói lên nghĩa gì. */
  hint?: string | ((form: Record<string, unknown>) => string);
  group?: string;               // nhóm section trong drawer
  showIf?: (form: Record<string, unknown>) => boolean;  // ẩn/hiện field theo giá trị khác
  default?: unknown;            // prefill khi TẠO MỚI (giá trị thật, không phải placeholder "0")
  /** Prefill khi TẠO MỚI, TÍNH TỪ form đang gõ — và tính LẠI mỗi khi form đổi, CHỪNG NÀO người
   *  khai chưa tự sửa ô này (sửa rồi, kể cả xoá trắng, thì máy thôi đụng vào).
   *
   *  Khác `default` ở chỗ giá trị đúng phụ thuộc ô khác mà ô đó lại chọn SAU khi drawer đã mở:
   *  công thức tiền giấy nhân định lượng × diện tích khi ĐVT là kg, nhưng chỉ `đơn giá × số tờ`
   *  khi bán theo tờ — điền một chuỗi rồi mặc kệ là điền sai cho nửa số mặt hàng, mà sai kiểu đó
   *  vẫn ra một con số trông hợp lý nên không ai soi ra.
   *
   *  KHÔNG chạy khi đang SỬA: bản ghi cũ để trống ô là một quyết định đã có, tự điền vào lúc mở
   *  ra xem là sửa dữ liệu sau lưng người dùng. */
  macDinhTheo?: (form: Record<string, unknown>) => unknown;
  jsonKey?: string;             // field lưu LỒNG trong cột JSON này (vd "fields_theo_loai")
}

export interface ColumnDef {
  key: string;
  label: string;
  /** Bề rộng cột bằng px (lưới kiểu bảng tính, 08/10/2026). Vắng = cột co giãn ăn phần còn lại —
   *  chỉ nên để vắng ở cột CUỐI (Ghi chú). Chữ dài hơn bề rộng bị cắt "…", rê chuột xem đủ. */
  w?: number;
  /** Cột số: canh phải, chữ số đều nhau. */
  n?: boolean;
  /** `extra` = dữ liệu PHỤ của chính dòng này, do `config.loadExtra` nạp song song (vd trạng thái
   *  máy lúc này). `undefined` khi chưa nạp xong hoặc dòng không có gì để nói. */
  render?: (r: Row, extra?: unknown) => ReactNode;
}

/** Một điều kiện của THANH LỌC chung (`pages/thanh-loc/ThanhLoc`, 06/10/2026) — chọn MỘT giá trị.
 *  `key` là tên QUERY PARAM gửi máy chủ VÀ khoá trên URL; backend phải khai đúng tên đó (`loc` /
 *  `loc_them` của router danh mục) — lệch một chữ là FastAPI bỏ qua tham số lạ IM LẶNG.
 *
 *  Giá trị chọn được = nền khai sẵn (`giaTri` hoặc danh mục `nguon`) + mọi giá trị CÓ THẬT trong
 *  dữ liệu mà máy chủ đếm được (`dem[key]` của phong bì danh sách, kèm nhãn nếu máy chủ biết —
 *  tên khách, tên tổ…). Số bên cạnh mỗi giá trị cũng lấy từ `dem`, đếm dưới mọi bộ lọc KHÁC. */
export interface DieuKienDanhMuc {
  key: string;
  nhan: string;
  /** Tên icon (lucide) — chọn ở `CatalogListPage`, giữ file này không import component. */
  icon?: "nhom" | "nguoi" | "trang-thai" | "vi-tri" | "don-vi" | "xe" | "dung-cu";
  /** Nhãn khai sẵn cho giá trị (bảng nhãn thuần Việt) — giá trị trong nền vẫn hiện khi đếm 0. */
  giaTri?: Option[];
  /** Nhãn cho giá trị NGOÀI nền mà máy chủ vẫn đếm được (vd loại khuôn đã gỡ khỏi lựa chọn). */
  nhanGiaTri?: Record<string, string>;
  /** Danh mục THẬT sinh giá trị (vd `/api/nhom-may`): `ten` vừa là giá trị vừa là nhãn. */
  nguon?: string;
}

/** Bản ghi danh mục. Khai lại ở đây (thay vì import từ `api/rebuildCatalog`) để `types.ts` giữ
 *  đúng lời hứa "không import gì ngoài `type ReactNode`" — hai khai báo phải khớp nhau. */
export type Row = Record<string, unknown> & { id: number; ma: string; ten: string };

export interface CatalogConfig {
  title: string;
  /** Tiêu đề H1 RIÊNG khi cần KHÁC `title` — vd menu là "Khai báo kho" nhưng danh từ ở nút/lọc vẫn
   *  là "kho hàng" ("Thêm kho hàng", "Lọc kho hàng"). Bỏ trống ⇒ H1 dùng luôn `title`. CHỈ đổi H1. */
  heading?: string;
  prefix: string;
  /** Khoá module RBAC gác các nút GHI của màn (Thêm = `create` · Xóa = `delete` · Bật lại =
   *  `update`). Lấy đúng chuỗi đang khai ở `components/Sidebar.tsx` — sai một ký tự là vai có
   *  quyền vẫn không thấy nút. Bỏ trống = KHÔNG gác, giữ y hành vi cũ (backend vẫn chặn bằng 403,
   *  đây chỉ để đừng bày ra nút bấm-xong-mới-báo-lỗi). */
  moduleQuyen?: string;
  /** Khoá loại của bản ghi trong nhật ký (`"{loai}:{id}"` — khớp `LOAI_MODULE` ở backend).
   *  Có khoá này thì drawer mọc thêm tab "Nhật ký" khi đang SỬA một bản ghi đã lưu. */
  nhatKyLoai?: string;
  columns: ColumnDef[];
  /** Bề rộng (px) hai cột đầu trang tự vẽ, đều được ghim khi cuộn ngang. Vắng ⇒ Mã 130 · Tên 240,
   *  hợp với danh mục tên dài (Giấy, Thành phẩm). Chỉ hạ khi mã/tên ngắn mà màn lại nhiều cột:
   *  Công đoạn tên chỉ "Bế", "Dán" mà giữ 240 thì phần cuộn ngang dài ra vô ích. */
  widthMa?: number;
  widthTen?: number;
  fields: FieldDef[];
  /** Điều kiện của thanh lọc (ngoài kỳ Ngày tạo + Đang dùng / Đã ngừng, hai thứ trang tự có). */
  dieuKien?: DieuKienDanhMuc[];
  /** Mã màn trên URL (`?man=`) — trùng id mục thanh bên (`REBUILD_CONFIGS`) để mở link là vào
   *  thẳng màn với đúng bộ lọc. Vắng thì suy từ `prefix`. */
  man?: string;
  /** Chữ mờ trong ô tìm khi màn tìm được NHIỀU hơn mã/tên (vd Khuôn tìm cả tên khách, số kệ).
   *  Vắng ⇒ "Tìm mã / tên…". Nói đúng ô tìm quét những gì, không thì chẳng ai thử gõ tên khách. */
  timGoiY?: string;
  /** Dữ liệu PHỤ nạp SONG SONG danh sách, khoá theo id bản ghi — cột nào cần thì đọc ở tham số
   *  thứ hai của `render`. Dùng cho số DẪN XUẤT không thuộc bản ghi (vd trạng thái máy suy từ sự
   *  cố + vùng khoá + lệnh đang chạy). Cố ý KHÔNG nhét vào schema CRUD dùng chung: schema đó
   *  đang đổ dropdown cho cả chục màn khác, bắt họ trả giá cho số chỉ một màn cần là sai chỗ.
   *  Hỏng thì NUỐT (trả `{}`) — mất cột phụ không được phép làm trắng cả bảng danh mục. */
  loadExtra?: (token: string) => Promise<Record<string, unknown>>;
  /** Nhãn của TAB chứa các ô công thức. Mặc định "Công thức tính giá" — đúng cho màn có ô ra TIỀN
   *  (Giấy · Vật tư · Công đoạn), SAI cho màn chỉ có ô ra LƯỢNG: máy khai cách đo theo đơn vị tốc
   *  độ, công việc khoán khai cách đo lượng khoán, cả hai không nhắc tới tiền. Nhãn sai ở đây mời
   *  người khai gõ công thức tiền vào ô lượng — mà gõ nhầm thì tiền chảy vào chỗ đếm lượng, không
   *  ai soi ra. Màn có `renderExtra` (Đơn vị) vẫn giữ nhãn riêng của nó. */
  nhanTabCongThuc?: string;
  /** Chia phần khai báo thành nhiều TAB theo `group`. Chỉ màn khai dài mới cần (Máy có 7 nhóm,
   *  cuộn một mạch rất mệt). Không khai thì render một mạch như cũ. Nhóm không liệt kê ở đây rơi
   *  vào tab ĐẦU TIÊN — quên khai một nhóm thì nó vẫn hiện, không biến mất im lặng. */
  tabsKhai?: { id: string; label: string; groups: string[] }[];
  // Block phụ cuối drawer (preview BHR của Máy · bảng quy đổi của Đơn vị). `existing` = null khi
  // đang TẠO — block nào cần id thì tự nhắc "lưu trước đã".
  renderExtra?: (form: Record<string, unknown>, existing: Row | null) => ReactNode;
  /** Khối CHỈ ĐỌC cuối tab khai báo, chỉ khi đang SỬA — thứ bảng có lưu nhưng không ai gõ tay
   *  (vd Thành phẩm: đơn/khách đặt lần đầu, ngày khai). Không đi vào `form` nên không lọt vào body
   *  gửi lên và không làm bật hộp "bỏ thay đổi?". */
  renderChiDoc?: (existing: Row) => ReactNode;
  /** Dòng CHỈ ĐỌC (vd 6 mục cố định của Mục thu chi): trả câu giải thích ⇒ tên kèm ổ khoá (rê chuột
   *  đọc câu đó), không nút, bấm dòng không mở form. `null` = dòng thường. */
  dongKhoa?: (r: Row) => string | null;
  /** Dòng khoá VẪN mở form được (vd Kho thành phẩm: khai vị trí cất) — chỉ ổ khoá + mất nút Xoá;
   *  phần nào không sửa được do máy chủ chặn. */
  dongKhoaMoDuoc?: boolean;
  /** Bỏ cột Ngày tạo (màn có dòng không ngày tạo, vd mục cố định). */
  anNgayTao?: boolean;
  softDelete?: boolean;         // "Xóa" = ẩn mềm (active=false), giữ dữ liệu; list chỉ hiện active
  /** Danh mục do HỆ SINH, không ai gõ tay ⇒ giấu nút "Thêm". Máy chủ chặn song song
   *  (`VatLieuKhoService._chan_go_tay`) — giấu nút mà không chặn thì một lời gọi API thẳng vẫn
   *  đẻ được dòng. Dùng cho Thành phẩm: `OrderService.confirm()` khai, xem docs/prd-thanh-pham.md. */
  khongTaoTay?: boolean;
  /** Giấu nút "Xóa". Cho danh mục mà dòng có thể đang được lô tồn / chứng từ trỏ vào — xoá là
   *  làm mồ côi. Ngừng dùng thì tắt `active`. */
  khongXoa?: boolean;
  /** Bày nút "Nhân bản" ở mỗi dòng (gọi `crud(prefix).clone`, gác quyền `clone`). Server copy toàn
   *  bộ cột, tự đặt mã/tên "(bản sao)" không trùng; bấm xong mở luôn drawer bản ghi mới để đổi tên
   *  ngay. Chỉ bật ở danh mục khai tay, có endpoint `/clone` thật (xem `enable_clone` ở backend). */
  enableClone?: boolean;
  /** Bày 2 nút "Xuất Excel" / "Nhập Excel" ở đầu bảng.
   *
   *  "Xuất Excel" ra CHỈ dòng đang dùng nhưng ĐỦ ô cấu hình hiện hành — mọi công thức, bậc tính và
   *  bảng con nằm ở sheet riêng đọc được (không JSON thô), không kèm lịch sử. Danh mục rỗng thì chỉ
   *  còn dòng tiêu đề, tự đóng vai file mẫu; vì thế KHÔNG còn nút "Tải mẫu" riêng.
   *
   *  "Nhập Excel" là UPSERT theo mã, HAI BƯỚC (xem trước → xác nhận) và CẢ FILE LÀ MỘT GIAO DỊCH:
   *  còn một dòng lỗi thì không ghi gì cả. Chỉ bật ở danh mục có `CatalogExcelSpec` khai ở
   *  `services/catalog_excel_specs.py` (hiện đủ 13 màn).
   *
   *  HAI mức quyền khác nhau: "Xuất Excel" chỉ cần quyền ĐỌC (đã ngầm định vì đang xem được bảng);
   *  "Nhập Excel" đòi CẢ `create` LẪN `update` — một dòng có thể là tạo mới hoặc cập nhật, server
   *  cũng gác `/import-excel` bằng đúng cặp quyền đó. */
  enableImport?: boolean;
  autoCode?: boolean;           // mã sinh NGẦM ở backend → ẩn ô "Mã" lúc tạo, không gửi ma
  /** Đổi CHỮ trên nhãn ô "Mã" (mặc định "Mã"). Cho danh mục mà khoá nghiệp vụ có tên riêng ai
   *  cũng gọi — vd Xe giao hàng: khoá là BIỂN SỐ. Gọi nó là "Mã" thì người khai gõ biển số vào ô
   *  Tên rồi để nguyên mã tự sinh. KHÔNG đổi tên cột API, chỉ đổi chữ hiện ra. */
  nhanMa?: string;
  /** Tắt mã GỢI Ý cho bản ghi mới. Mặc định drawer hỏi máy chủ rồi điền sẵn "MA-0001" — đúng cho
   *  danh mục có mã chạy số, SAI cho danh mục mà mã là một thứ có thật ngoài đời (biển số): điền
   *  sẵn là mời người ta bấm Lưu với cái mã vô nghĩa đó. */
  khongGoiYMa?: boolean;
  /** Tạo xong thì GIỮ drawer mở ở bản ghi vừa tạo. Dùng cho màn có khối con phải gắn vào id (vd
   *  Đơn vị: tạo "tấn" xong khai ngay quy đổi) — đóng phắt là bắt người ta đi tìm lại dòng. */
  moLaiSauKhiTao?: boolean;
  deriveInitial?: (existing: Row | null) => Record<string, unknown>;  // giá trị UI suy ra khi mở form (vd _method)
  // map field UI → body API trước khi gửi. `existing` = bản ghi đang sửa (null khi TẠO) — cần khi
  // phải GỘP vào một cột JSON: field bị `showIf` ẩn thì không có trong `body`, dựng lại cột JSON
  // từ số 0 là xoá mất các khoá khác của cột đó.
  transformSubmit?: (
    body: Record<string, unknown>,
    form: Record<string, unknown>,
    existing: Row | null,
  ) => Record<string, unknown>;
  /** Ghi đè luồng XÓA mặc định (`XoaDanhMucDialog` + ẩn mềm) bằng dialog riêng — vd Kho: kiểm kho
   *  còn tồn / phiếu chờ ghi sổ / đề nghị dở rồi bắt gõ mã mới cho xóa. Dialog tự gọi API; xong
   *  gọi ctx.onDone (đóng + reload), hủy thì ctx.onClose. */
  renderDeleteDialog?: (row: Row, ctx: { token: string; onClose: () => void; onDone: () => void }) => ReactNode;
}

/** "Nhóm máy" là CHỮ TỰ DO nên phải đoán bằng tên. Định nghĩa ở đây (không phải trong
 *  `rebuildCatalogConfigs`) vì cả trang lẫn config cùng dùng, mà config đã import từ file này —
 *  để bên kia rồi import ngược lại là thành vòng tròn. */
export const isMayIn = (val: unknown) => {
  const s = String(val || "").trim().toLowerCase();
  return s === "máy in" || s === "in ngoài" || s.startsWith("in ") || s.includes("máy in") || s.includes("in offset");
};

// ── Kiểu dữ liệu của các ô BẢNG ĐỘNG (fields/) ───────────────────────────────────
// Để ở đây chứ không ở từng file ô: `rebuildCatalogConfigs` cần `ChuanBiKhoanRow`, mà config đã
// import từ barrel rồi — gom kiểu về một chỗ thì đường import không phải rẽ theo từng ô.

/** Một bậc số lượng: Từ SL · Đến SL · Giá trị · Đơn vị (tờ hay %). */
/** Một bậc bù hao của công đoạn — chỉ khai MỐC TRÊN; `sl_den = null` là bậc vô hạn (luôn cuối).
 *  Cận dưới suy từ bậc liền trước nên ô `sl_tu` đã bỏ (22/09/2026). */
export interface BacRow { sl_den?: number | null; gia_tri?: number; don_vi?: string }

/** Một khoản chuẩn bị của máy (thay giấy 15p · thay mực 18p). Tổng là ô CHỈ ĐỌC, tự cộng. */
export interface ChuanBiKhoanRow { ten?: string; phut?: number }

/** Một VIỆC PHÁT SINH của công việc khoán (Thay kẽm · 100 đ · bản kẽm). `id` có khi dòng đã lưu —
 *  gửi ngược lên để server sửa đúng dòng đó thay vì đẻ dòng mới. `don_vi` là MÃ đơn vị. */
export interface ViecPhatSinhRow {
  id?: number; ten?: string; don_gia?: number | null; don_vi?: string;
  /** Giá theo tổ của việc phát sinh (21/10/2026) — rỗng/null = mọi tổ dùng `don_gia`. */
  gia_theo_to?: { department_id: number; don_gia?: number | null }[] | null;
}

/** Một dòng bảng giá theo tổ của cấu hình Khoán (21/10/2026). `bac` = mã bậc giá khi công đoạn
 *  chia bậc (22/10/2026) — mỗi ô (tổ, bậc) một dòng. */
  /** "Cách tính giá" (24/10/2026): công thức ra đơn giá trên lần ghi — có thì đơn giá / giá tổ không dùng. */
  cong_thuc?: string | null;
export interface GiaTheoToRow {
  department_id: number; bac?: string | null; gia_co_dinh?: number | null; don_gia?: number | null;
}

/** Một bậc giá (Bài in, 22/10/2026): điều kiện theo số màu (= số kẽm như Tính giá), màu pha, một tuỳ chọn Có /
 *  không. Ô điều kiện để trống (null) = không xét. Bậc đầu tiên khớp được dùng. */
export interface BacGiaRow {
  ma: string; ten: string;
  mau_tu?: number | null; mau_den?: number | null;
  pha?: "co" | "khong" | null;
  tuy_chon_ma?: string | null; tuy_chon_co?: "co" | "khong" | null;
  /** Giá của bậc đã gồm mực UV ⇒ chip "Giá đã gồm UV" = 1. */
  gom_uv?: boolean;
}

/** Một "tuỳ chọn khi ghi" của công đoạn (Đợt 2): thợ tick (Có / không = 1/0) hoặc gõ số ở từng lần
 *  ghi; `ma` là chip trong ô Công thức khoán. */
export interface TuyChonKhoanRow { ma: string; ten: string; kieu: "co_khong" | "so"; goi_y: string | null }

export interface KhoanCongDoanValue {
  id?: number;
  unit?: string;
  unit_price?: number | null;
  /** Giá cố định chung (Đợt 2) — bảng giá theo tổ rỗng thì mọi tổ dùng cả hai giá chung. */
  gia_co_dinh?: number | null;
  tuy_chon?: TuyChonKhoanRow[];
  cong_thuc_khoan?: string | null;
  /** Rỗng/null = mọi tổ dùng giá chung; có dòng thì tổ vắng mặt = thiếu giá. */
  gia_theo_to?: GiaTheoToRow[] | null;
  /** Bậc giá theo số màu (22/10/2026); rỗng/null = không chia bậc. Có bậc thì giá chung không dùng. */
  bac_gia?: BacGiaRow[] | null;
  viec_phat_sinh?: ViecPhatSinhRow[];
}

/** Việc con bên trong một gói bảo trì. */
export interface HangMucConRow { id?: string; ten?: string }

export interface LichBaoTriRow {
  id?: string; viec?: string; so?: number; don_vi?: string;
  // Mốc cho kỳ ĐẦU TIÊN: kỳ 1 rơi đúng vào ngày này. Từ kỳ 2 trở đi hạn = ngày HOÀN THÀNH phiếu
  // gần nhất + chu kỳ, nên ô này khai MỘT LẦN rồi thôi.
  // ⚠️ KHÁC hẳn ô "Lần cuối làm" đã bỏ 12/08/2026: ô đó bắt sửa lại sau MỖI lần bảo trì nên không
  // ai sửa, còn ô này chỉ để mồi lần đầu. Đừng gộp/gỡ nhầm hai thứ.
  ngay_bat_dau?: string;  // ISO date (yyyy-mm-dd)
  lan_cuoi?: string;      // (đã bỏ khỏi form) giá trị cũ vẫn giữ nguyên trong JSON khi lưu
  dung_phut?: number;     // 0/trống = không phải dừng máy
  hang_muc?: HangMucConRow[];   // việc con trong gói — không có cũng chạy (gói khai từ trước)
}

/** Một MÁY chạy được công đoạn, mang cách đo giờ và cách tính giá của riêng cặp (công đoạn, máy).
 *  Vì sao không treo ở máy: cùng một máy chạy hai công đoạn thì đo khác nhau (06/09/2026). */
export interface MayCongDoanRow {
  may_id: number;
  cong_thuc_gio?: string | null;
  /** Chỉ có nghĩa với công đoạn nhóm In — phiếu tính giá chỉ chọn máy ở khối In của thành phần. */
  cong_thuc_gia?: string | null;
}

/** Một dòng tab VẬT TƯ của công đoạn (mg `0316`): món nào + CÔNG THỨC ĐỊNH MỨC của riêng món đó.
 *  Mực ăn theo SỐ TỜ còn dung môi rửa máy ăn theo SỐ MÀU — cùng ĐVT kg mà hai cách khác hẳn, nên
 *  công thức treo ở dòng chứ không ở món hàng. Thay `DinhMucRow` (đầu việc định mức, gỡ mg `0320`). */
export interface VatTuCongDoanRow { vat_tu_id: number }
