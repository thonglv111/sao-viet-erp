/** Dịch một phần tử `detail` của lỗi 422 (FastAPI + pydantic v2) thành câu tiếng Việt.
 *
 *  Trước 18/10/2026 mỗi lỗi kiểm dữ liệu hiện nguyên chữ Anh của pydantic ("gsm: Input should be
 *  greater than 0") — người dùng chỉ biết ô sai, không biết sai thế nào. Nay dịch theo `type` (mã
 *  ổn định của pydantic, không dịch theo `msg` vì chữ Anh đổi theo phiên bản) và thay tên trường
 *  bằng NHÃN Ô khi biết nhãn. Trường lạ giữ nguyên tên trường; loại lỗi lạ rơi về câu cũ
 *  `đường dẫn: msg`, không bao giờ nuốt mất lỗi. */

/** Nhãn ô của các trường body hay gặp. Chỉ áp cho trường cấp cao nhất (đường dẫn một đoạn): trường
 *  lồng trong dòng (`lines › 0 › quantity`) giữ đường dẫn để còn biết sai ở dòng thứ mấy. */
const NHAN_TRUONG: Record<string, string> = {
  ma: "Mã",
  ten: "Tên",
  gsm: "Định lượng",
  don_gia: "Đơn giá",
  don_vi_gia: "Đơn vị tính",
  ghi_chu: "Ghi chú",
  so_luong: "Số lượng",
  quantity: "Số lượng",
  kho_rong: "Khổ rộng",
  kho_dai: "Khổ dài",
};

const so = (v: unknown): string => (typeof v === "number" ? v.toLocaleString("vi-VN") : String(v));

/** Vị ngữ theo loại lỗi; `null` = loại không biết, để nơi gọi giữ câu cũ. */
function viNgu(type: string, ctx: Record<string, unknown>): string | null {
  switch (type) {
    case "greater_than": return `phải lớn hơn ${so(ctx.gt)}`;
    case "greater_than_equal": return `phải từ ${so(ctx.ge)} trở lên`;
    case "less_than": return `phải nhỏ hơn ${so(ctx.lt)}`;
    case "less_than_equal": return `phải từ ${so(ctx.le)} trở xuống`;
    case "missing": return "không được để trống";
    case "string_too_short":
      return Number(ctx.min_length) <= 1 ? "không được để trống" : `phải có ít nhất ${so(ctx.min_length)} ký tự`;
    case "string_too_long": return `không được dài quá ${so(ctx.max_length)} ký tự`;
    case "too_short": return `phải có ít nhất ${so(ctx.min_length)} mục`;
    case "too_long": return `không được quá ${so(ctx.max_length)} mục`;
    case "int_parsing":
    case "int_type":
    case "int_from_float":
      return "phải là số nguyên";
    case "float_parsing":
    case "float_type":
    case "decimal_parsing":
    case "decimal_type":
      return "phải là số";
    case "string_type": return "phải là chữ";
    case "bool_parsing":
    case "bool_type":
      return "phải là có hoặc không";
    case "date_parsing":
    case "date_type":
    case "date_from_datetime_parsing":
    case "datetime_parsing":
    case "datetime_type":
      return "phải là ngày hợp lệ";
    case "literal_error":
    case "enum":
      return "không nằm trong các giá trị cho phép";
    default: return null;
  }
}

/** Câu cho MỘT lỗi; `null` nếu phần tử không có `msg` đọc được. */
export function cauLoi422(it: unknown): string | null {
  const o = it as { type?: unknown; loc?: unknown; msg?: unknown; ctx?: unknown } | null;
  if (typeof o?.msg !== "string") return null;
  // `loc` = ["body", "<trường>", <chỉ số>, ...] — bỏ "body", còn lại là đường dẫn tới ô sai.
  const doan = Array.isArray(o.loc)
    ? o.loc.filter((x) => x !== "body" && x !== "query" && x !== "path")
    : [];
  const duong = doan.join(" › ");
  const nhan = doan.length === 1 ? (NHAN_TRUONG[String(doan[0])] ?? duong) : duong;
  const ctx = (o.ctx && typeof o.ctx === "object" ? o.ctx : {}) as Record<string, unknown>;
  const vn = typeof o.type === "string" ? viNgu(o.type, ctx) : null;
  if (vn) return nhan ? `${nhan} ${vn}` : `Giá trị ${vn}`;
  // Validator tự viết của máy chủ (`value_error`/`assertion_error`): câu thường đã là tiếng Việt,
  // chỉ gỡ phần tiền tố cố định của pydantic.
  const msg = o.msg.replace(/^(Value error|Assertion failed),\s*/, "");
  return nhan ? `${nhan}: ${msg}` : msg;
}
