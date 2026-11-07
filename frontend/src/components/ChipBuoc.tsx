// HAI CHIP DÙNG CHUNG cho mọi màn có mặt một bước sản xuất — từ phiếu tính giá tới lúc lệnh xong.
//
// Vì sao phải là MỘT component chứ không phải mỗi màn tự vẽ: trước 04/09/2026 mỗi màn tự quyết
// định lại nhãn từ một dữ liệu KHÁC NHAU — màn Kế hoạch đọc `loai_buoc`, Gantt xếp lịch suy từ tên
// nhà cung cấp, bốn tab Theo dõi SX không đọc gì cả. Ba cách suy ba kết quả, nên nhãn đứt quãng
// giữa đường: bước đã gán Thuê ngoài mà chưa điền nơi làm thì tới Gantt là mất dấu.
//
// Nguyên tắc: nhãn là DỮ LIỆU đi theo bước, không phải thứ mỗi màn tự đoán lấy.
import "./chip-buoc.css";

const NHAN_LOAI: Record<string, string> = { may: "Máy", to: "Tổ" };

/** Dấu KCS trên thẻ việc (KCS theo lệnh, mg 0306): "KCS: đạt" hoặc "KCS: N lỗi" — N = lỗi DO công
 *  đoạn này gây, kể cả KCS bắt ở bước sau (08/10/2026). Chưa kiểm lần nào và không lỗi nào quy về
 *  ⇒ không vẽ gì. */
export function ChipKcs({ so_lan, loi }: { so_lan?: number | null; loi?: number | null }) {
  const coLoi = (loi ?? 0) > 0;
  if (!so_lan && !coLoi) return null;
  return (
    <span className={`chip-kcs chip-kcs--${coLoi ? "loi" : "dat"}`}
      title={so_lan ? `KCS đã kiểm ${so_lan} lần` : "Lỗi do công đoạn này, KCS bắt ở bước sau"}>
      {coLoi ? `KCS: ${(loi ?? 0).toLocaleString("vi-VN")} lỗi` : "KCS: đạt"}
    </span>
  );
}

export function ChipLoaiBuoc({
  loai_buoc,
  nha_cung_cap,
  capLenh = false,
}: {
  loai_buoc?: string | null;
  nha_cung_cap?: string | null;
  /** Bước LỆNH (07/11/2026): chỉ hai loại Nội bộ | Gia công, máy hay làm tay do bộ phận chọn sau.
   *  Việc ở xưởng (đã giao) vẫn nói "Máy"/"Tổ" vì lúc đó đã biết. */
  capLenh?: boolean;
}) {
  if (!loai_buoc) return null;
  if (capLenh) {
    const ngoai = loai_buoc === "thue_ngoai";
    return <span className={`chip-buoc chip-buoc--${ngoai ? "ngoai" : "may"}`}>{ngoai ? "Gia công" : "Nội bộ"}</span>;
  }
  if (loai_buoc === "thue_ngoai") {
    // NƠI LÀM của bước thuê ngoài nay là MÁY của nhà thầu (khai trong danh mục Máy, tên kèm hậu
    // tố "thuê ngoài – <nhà in>") — cột "Thực hiện" của bảng/thẻ đã bày tên máy đó. Nên chip chỉ
    // còn nói LOẠI bước, y như "Máy"/"Tổ", và KHÔNG kêu "chưa chọn nơi làm" nữa: ô nhập nhà cung
    // cấp đã gỡ khỏi màn kế hoạch, giữ lời kêu đó thì mọi bước đều đỏ vĩnh viễn.
    const cu = (nha_cung_cap ?? "").trim();   // dữ liệu CŨ còn sót thì vẫn bày ra
    return (
      <span className="chip-buoc chip-buoc--ngoai">
        {cu ? `Thuê ngoài ${cu}` : "Thuê ngoài"}
      </span>
    );
  }
  const nhan = NHAN_LOAI[loai_buoc];
  if (!nhan) return null;
  return <span className={`chip-buoc chip-buoc--${loai_buoc}`}>{nhan}</span>;
}

export interface KhuonChip {
  ma?: string | null;
  ten?: string | null;
  so_ke?: string | null;
  tinh_trang?: string | null;
  /** Tổ đã tích "đã nhận khuôn" — chỉ có nghĩa ở các màn xưởng. */
  da_nhan?: boolean;
}

export function ChipKhuon({
  can_khuon,
  khuon,
}: {
  can_khuon?: boolean;
  khuon?: KhuonChip | null;
}) {
  if (!can_khuon) return null;
  // Nhãn dựng thành MỘT chuỗi rồi mới render: ghép nhiều mảnh trong JSX đẻ ra nhiều text node, chuỗi
  // hiện đúng nhưng máy đọc màn hình (và cả test) thấy mảnh rời. Mã và tình trạng nối bằng chữ như
  // câu nói ("KB-0123 ở Kệ A3"), không nối bằng dấu chấm giữa (05/11/2026).
  let cls = "co";
  let chu: string;
  if (!khuon || !khuon.ma) {
    // Bước CÓ yêu cầu dụng cụ mà chưa trỏ dao nào là trạng thái phải NHÌN THẤY, không phải chỗ
    // trống để im lặng: đó chính là thứ chặn ở cửa "Sẵn sàng lập kế hoạch".
    cls = "thieu";
    chu = "chưa chốt khuôn";
  } else if (khuon.da_nhan) {
    cls = "nhan";
    chu = `${khuon.ma} đã nhận`;
  } else if (khuon.tinh_trang === "dang_dat_lam") {
    // Không còn ngày dự kiến (mg `0293` gỡ cột): chip nói ĐÚNG cái hệ biết — dao chưa trong tay.
    cls = "cho";
    chu = `${khuon.ma} đang đặt làm`;
  } else {
    const ke = (khuon.so_ke ?? "").trim();
    chu = ke ? `${khuon.ma} ở ${ke}` : String(khuon.ma);
  }
  return (
    <span className={`chip-khuon chip-khuon--${cls}`}>
      <span aria-hidden="true">🔧</span>
      {chu}
    </span>
  );
}

/** Khối `nhan` mà backend gắn lên mỗi bước (Kanban · Theo máy · Theo ca · KCS · Kho). */
export interface NhanBuoc {
  loai_buoc?: string | null;
  nha_cung_cap?: string | null;
  khuon_ma?: string | null;
  khuon_so_ke?: string | null;
  khuon_tinh_trang?: string | null;
  khuon_da_nhan?: boolean;
}

/** `nhan` → props của `<ChipKhuon>`. Một chỗ đổi tên field là mọi màn theo — bốn màn tự trải
 *  `nhan.khuon_*` ra là bốn chỗ để quên một field, đúng lối hỏng mà hai chip này sinh ra để chặn. */
export function nhanKhuon(n?: NhanBuoc | null): KhuonChip {
  return {
    ma: n?.khuon_ma ?? null,
    so_ke: n?.khuon_so_ke ?? null,
    tinh_trang: n?.khuon_tinh_trang ?? null,
    da_nhan: n?.khuon_da_nhan ?? false,
  };
}

/** Một chữ NGẮN cho `title` của thanh Gantt hẹp (Theo máy) — chỗ không đủ bề ngang cho chip thật,
 *  nhưng vẫn phải nói ra được nhãn khi rê chuột. Rỗng nếu bước không có gì để nói. */
export function nhanTomTat(n?: NhanBuoc | null): string {
  const ra: string[] = [];
  if (n?.loai_buoc === "thue_ngoai") {
    const cu = (n.nha_cung_cap ?? "").trim();
    ra.push(cu ? `Thuê ngoài ${cu}` : "Thuê ngoài");
  }
  if (n?.khuon_ma) {
    ra.push(
      n.khuon_da_nhan
        ? `${n.khuon_ma} đã nhận`
        : n.khuon_tinh_trang === "dang_dat_lam"
          ? `${n.khuon_ma} đang đặt làm`
          : `${n.khuon_ma}${(n.khuon_so_ke ?? "").trim() ? ` ở ${n.khuon_so_ke}` : ""}`,
    );
  }
  return ra.join("\n");
}
