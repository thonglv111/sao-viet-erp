// Cảnh báo TRÊN TỪNG DÒNG routing (`loiDong`) — đóng đinh vụ "đứt đơn vị" giả 16/08/2026.
//
// Bối cảnh: bước ghi kẽm khai `m² → bài in` (hợp lệ từ 11/08/2026, khi công đoạn được khai đơn vị
// tự do từ danh mục). Luật cũ lấy "bước trước gần nhất CÓ khai đơn vị" nên vớ đúng bước chế bản
// rồi so `bài in` với `tờ` — mọi lệnh có chế bản đều đeo cảnh báo, cả 3 lệnh trên DB dev.
//
// Vì sao đáng một file test riêng: cảnh báo giả không làm gãy gì cả, nó chỉ dạy người dùng bỏ qua
// cột "Cần xem lại". Không có test thì lần sau ai đó "dọn" cái cờ `tren_dong_giay` là nó lặng lẽ
// quay lại.
import { describe, expect, it } from "vitest";
import { boBuoc, chenBuoc, doiChoBuoc, donViChuoi, tickConLaCuaNguoiKhac, CUA_SO_TU_LAM_MS, emptyRow, lyDoChanLuu, giayChoLuu, laMayTinh, loiDong, congDoanKhongMay, mayChonDuoc, mayMacDinhCuaTo, nhanGiayTheoDauVao, toChuaCoMay, toBody, toEdit, toKhacCuaMay, type EditRow } from "./lsxBuoc";

/** Dòng routing tối thiểu. `may_id` đặt sẵn để khỏi dính cảnh báo "chưa gán tổ / máy" — thứ đang
 *  không phải chủ đề của phần lớn test dưới đây. */
function dong(p: Partial<EditRow>): EditRow {
  return { ...emptyRow(), may_id: 1, ...p };
}

/** Đúng chuỗi 6 bước của LSX26-0004 trên DB dev (sách 160 trang, 5 tay/cuốn). */
function chuoiSach(): EditRow[] {
  return [
    dong({ ten: "Ghi kẽm CTP", nhom: "prepress", don_vi_vao: "m2", don_vi_ra: "bai",
           tren_dong_giay: false, so_luong_vao: "1801", so_luong_ra: "7200" }),
    dong({ ten: "In offset", nhom: "print", don_vi_vao: "to", don_vi_ra: "to",
           so_luong_vao: "5200", so_luong_ra: "5000" }),
    dong({ ten: "Gấp tay sách", don_vi_vao: "to", don_vi_ra: "tay",
           so_luong_vao: "5000", so_luong_ra: "5000" }),
    dong({ ten: "Bắt tay + vào keo", don_vi_vao: "tay", don_vi_ra: "cai",
           so_luong_vao: "5000", so_luong_ra: "1000" }),
    dong({ ten: "Xén 3 mặt thành phẩm", don_vi_vao: "cai", don_vi_ra: "cai",
           so_luong_vao: "1000", so_luong_ra: "1000" }),
    dong({ ten: "Đóng gói + nhập kho", don_vi_vao: "cai", don_vi_ra: "cai",
           so_luong_vao: "1000", so_luong_ra: "1000" }),
  ];
}

const loiCua = (rows: EditRow[]) => rows.map((_r, i) => loiDong(rows, i));

describe("loiDong — đứt đơn vị", () => {
  it("bước NGOÀI dòng giấy không kéo cảnh báo giả xuống bước in ngay sau", () => {
    const rows = chuoiSach();
    // Bản cũ: bước In offset (#1) so `bài in` (ra của chế bản) với `tờ` ⇒ "đứt đơn vị".
    expect(loiDong(rows, 1)).not.toContain("đứt đơn vị");
    // Và cả chuỗi phải sạch — đây là routing ĐÚNG, không có gì để kêu.
    expect(loiCua(rows).flat()).toEqual([]);
  });

  it("bước ngoài dòng giấy KHÔNG bị soi đơn vị, kể cả khi nó đứng giữa chuỗi", () => {
    const rows = [
      dong({ ten: "In offset", don_vi_vao: "to", don_vi_ra: "to" }),
      dong({ ten: "Ghi kẽm CTP", don_vi_vao: "m2", don_vi_ra: "bai", tren_dong_giay: false }),
      dong({ ten: "Gấp tay sách", don_vi_vao: "to", don_vi_ra: "tay" }),
    ];
    // Bước #2 phải nối với bước IN (#0), nhảy qua chế bản — không phải nối với `bài in`.
    expect(loiDong(rows, 2)).not.toContain("đứt đơn vị");
    expect(loiDong(rows, 1)).not.toContain("đứt đơn vị");
  });

  it("đứt THẬT vẫn bắt được — bỏ khâu gấp/bắt tay thì tờ không ra thẳng cái", () => {
    const rows = [
      dong({ ten: "In offset", don_vi_vao: "to", don_vi_ra: "to" }),
      dong({ ten: "Đóng gói + nhập kho", don_vi_vao: "cai", don_vi_ra: "cai" }),
    ];
    expect(loiDong(rows, 1)).toContain("đứt đơn vị");
  });

  it("bước ĐẦU chuỗi không có gì phía trước để đứt", () => {
    expect(loiDong([dong({ don_vi_vao: "to", don_vi_ra: "to" })], 0)).toEqual([]);
  });

  it("tuyến rẽ nhánh so với TIỀN NHIỆM THẬT, không với dòng liền trên (e2e chuẩn bị giấy 24/10)", () => {
    // Hộp sóng nguồn cuộn: Tề sóng là nhánh riêng chỉ nối vào Bồi, đứng ngay trên Cắt giấy cuộn
    // trong bảng. Bản cũ so `tờ in` (ra của Tề sóng) với `tờ nguyên` (vào của Cắt giấy cuộn).
    const rows = [
      dong({ ten: "Tề sóng", key: "ts", don_vi_vao: "to", don_vi_ra: "to" }),
      dong({ ten: "Cắt giấy cuộn", key: "cgc", don_vi_vao: "to_nguyen", don_vi_ra: "to_nguyen" }),
      dong({ ten: "Tề giấy in", key: "tgi", don_vi_vao: "to_nguyen", don_vi_ra: "to",
             phu_thuoc_step_keys: ["cgc"] }),
      dong({ ten: "In", key: "in", don_vi_vao: "to", don_vi_ra: "to", phu_thuoc_step_keys: ["tgi"] }),
      dong({ ten: "Bồi", key: "boi", don_vi_vao: "to", don_vi_ra: "to",
             phu_thuoc_step_keys: ["in", "ts"] }),
    ];
    expect(loiCua(rows).flat()).toEqual([]);
    // Đứt thật trên một nhánh vẫn bắt: Bồi nhận `cái` mà tiền nhiệm ra `tờ in`.
    const dut = rows.map((r) => (r.key === "boi" ? { ...r, don_vi_vao: "cai" } : r));
    expect(loiDong(dut, 4)).toContain("đứt đơn vị");
  });
});

describe("loiDong — các kiểm còn lại giữ nguyên", () => {
  it("ra nhiều hơn vào khi KHÔNG đổi đơn vị", () => {
    const r = dong({ don_vi_vao: "to", don_vi_ra: "to", so_luong_vao: "100", so_luong_ra: "120" });
    expect(loiDong([r], 0)).toContain("ra nhiều hơn vào");
  });

  it("đổi đơn vị thì ra > vào là chuyện thường (1 tờ bế ra 8 con)", () => {
    const r = dong({ don_vi_vao: "to", don_vi_ra: "con", so_luong_vao: "100", so_luong_ra: "800" });
    expect(loiDong([r], 0)).not.toContain("ra nhiều hơn vào");
  });

  it("chưa gán tổ / máy", () => {
    const r = { ...emptyRow(), department_id: null, may_id: null };
    expect(loiDong([r], 0)).toContain("chưa gán tổ / máy");
  });

  it("thuê ngoài không đòi tổ / máy — đòi nhà gia công", () => {
    // Bước thuê ngoài chọn nhà gia công từ danh mục NCC (26/09/2026), không có tổ / máy.
    const r = { ...emptyRow(), loai_buoc: "thue_ngoai" as const, department_id: null, may_id: null };
    expect(loiDong([r], 0)).not.toContain("chưa gán tổ / máy");
    expect(loiDong([r], 0)).toContain("chưa chọn nhà gia công");
    expect(loiDong([{ ...r, nha_cung_cap_id: 3 }], 0)).not.toContain("chưa chọn nhà gia công");
  });

  it("trùng bước trước", () => {
    const rows = [dong({ ten: "Cán màng mờ" }), dong({ ten: "Cán màng mờ" })];
    expect(loiDong(rows, 1)).toContain("trùng bước trước");
  });
});

// Máy chọn được trong drawer bước — phải khớp ĐÚNG luật `may_to.may_chon_duoc` của backend (máy
// thuộc tổ, spec 2026-10-22-may-thuoc-to). Không khớp thì kế hoạch gán được một máy mà lưu lệnh /
// bài ghép sẽ từ chối, và người dùng chỉ biết ở khâu sau cùng.
describe("mayChonDuoc — máy nào được mời cho một bước", () => {
  const TO_2MAU = 1, TO_4MAU = 2, TO_KHONG_MAY = 3;
  const IN01 = 11, IN02 = 12, IN03 = 13;
  const MAY = [
    { id: IN01, ten: "IN-01", toIds: [TO_2MAU] },
    { id: IN02, ten: "IN-02", toIds: [TO_4MAU] },
    { id: IN03, ten: "IN-03", toIds: [TO_4MAU], active: false },
    { id: 27, ten: "TB-0001", toIds: [] },
  ];
  const ten = (ds: { ten: string }[]) => ds.map((m) => m.ten);
  const CD = { mayChoPhep: [IN01, IN02, IN03], coRangBuocTo: true };

  it("công đoạn có tổ ⇒ chỉ máy của tổ đang chọn", () => {
    expect(mayChonDuoc(MAY, CD, TO_2MAU, null).map((m) => m.id)).toEqual([IN01]);
  });

  it("máy ĐANG gán luôn còn trong danh sách dù không thuộc tổ", () => {
    // Lệnh cũ gán IN-02 rồi đổi tổ. Loại nó đi là ô máy về trống trơn, người lập tưởng chưa gán.
    expect(mayChonDuoc(MAY, CD, TO_2MAU, IN02).map((m) => m.id)).toEqual([IN01, IN02]);
  });

  it("công đoạn chưa tick tổ ⇒ không ràng buộc tổ, mời cả bảng máy", () => {
    expect(mayChonDuoc(MAY, { mayChoPhep: [IN01, IN02], coRangBuocTo: false }, TO_2MAU, null))
      .toHaveLength(2);
  });

  it("chưa chọn tổ ⇒ cả bảng máy còn dùng của công đoạn", () => {
    expect(ten(mayChonDuoc(MAY, CD, null, null))).toEqual(["IN-01", "IN-02"]);
  });

  it("công đoạn chưa khai máy nào và không tổ ⇒ mọi máy", () => {
    expect(mayChonDuoc(MAY, { mayChoPhep: null, coRangBuocTo: false }, null, null)).toHaveLength(3);
    expect(mayChonDuoc(MAY, null, null, null)).toHaveLength(3);
  });

  it("máy ngừng dùng không được mời", () => {
    expect(mayChonDuoc(MAY, CD, TO_4MAU, null).map((m) => m.id)).toEqual([IN02]);
  });

  it("máy mặc định của tổ = máy đầu bảng thuộc tổ, tổ không có máy ⇒ null", () => {
    expect(mayMacDinhCuaTo(MAY, CD, TO_4MAU)).toBe(IN02);
    expect(mayMacDinhCuaTo(MAY, CD, TO_2MAU)).toBe(IN01);
    expect(mayMacDinhCuaTo(MAY, CD, TO_KHONG_MAY)).toBeNull();
  });

  it("tổ chỉ có ĐÚNG máy đang gán vẫn là tổ CÓ máy — câu 'chưa có máy' chỉ khi tổ trống hẳn", () => {
    expect(toChuaCoMay(MAY, CD, TO_2MAU)).toBe(false);       // IN-01 là máy duy nhất, đang gán
    expect(toChuaCoMay(MAY, CD, TO_KHONG_MAY)).toBe(true);
    expect(toChuaCoMay(MAY, { mayChoPhep: [IN01], coRangBuocTo: false }, TO_KHONG_MAY)).toBe(false);
    expect(toChuaCoMay(MAY, CD, null)).toBe(false);
  });

  // Ngay sau mg 0435 mọi công đoạn có tick tổ mà chưa máy nào khai tổ ⇒ bảng máy rỗng. Máy chủ
  // (`may_to.may_chon_duoc`) trả [] và lưu bất kỳ máy nào là 400 — ô máy KHÔNG được mời mọi máy.
  const CD_TRONG = { mayChoPhep: [] as number[], coRangBuocTo: true };

  it("công đoạn có tổ mà chưa có máy nào ⇒ không mời máy nào, chỉ giữ máy đang gán", () => {
    expect(mayChonDuoc(MAY, CD_TRONG, TO_2MAU, null)).toEqual([]);
    expect(mayChonDuoc(MAY, CD_TRONG, null, null)).toEqual([]);
    expect(mayChonDuoc(MAY, CD_TRONG, TO_2MAU, IN02).map((m) => m.id)).toEqual([IN02]);
  });

  it("công đoạn có tổ mà chưa có máy nào ⇒ tổ đang chọn là tổ chưa có máy", () => {
    expect(toChuaCoMay(MAY, CD_TRONG, TO_2MAU)).toBe(true);
    expect(mayMacDinhCuaTo(MAY, CD_TRONG, TO_2MAU)).toBeNull();
  });

  it("công đoạn mà mọi tổ đều không có máy CÒN DÙNG ⇒ bước mặc định loại tổ", () => {
    expect(congDoanKhongMay(MAY, CD_TRONG)).toBe(true);
    expect(congDoanKhongMay(MAY, { mayChoPhep: [IN03], coRangBuocTo: true })).toBe(true); // ngừng dùng
    expect(congDoanKhongMay(MAY, CD)).toBe(false);
    expect(congDoanKhongMay(MAY, { mayChoPhep: [], coRangBuocTo: false })).toBe(false);
    expect(congDoanKhongMay(MAY, null)).toBe(false);
  });
});

// --- Chèn / bỏ bước phải NỐI LẠI DÂY (09/09/2026) ------------------------------------------
//
// Bối cảnh: sơ đồ DAG vẽ theo `phu_thuoc_step_keys`, còn số lượng bám `thu_tu`. Nút "Chèn
// trước/sau" trước đây chỉ `splice` một dòng rỗng vào mảng nên số vẫn chảy đúng mà bước mới đứng
// trơ không dây trên sơ đồ — nhìn thì tưởng chuỗi liền, lưu xuống mới lộ.

/** Chuỗi thẳng A → B → C, dây khai đúng như server tự nối lúc tạo lệnh. */
function chuoiThang(): EditRow[] {
  const a = dong({ ten: "A", key: "ka" });
  const b = dong({ ten: "B", key: "kb", phu_thuoc_step_keys: ["ka"] });
  const c = dong({ ten: "C", key: "kc", phu_thuoc_step_keys: ["kb"] });
  return [a, b, c];
}

/** `[tên, tiền nhiệm...]` cho dễ đọc kỳ vọng — key sinh ra là UUID nên không so thẳng được. */
function day(rows: EditRow[]): string[][] {
  const ten = new Map(rows.map((r) => [r.key, r.ten || "MỚI"]));
  return rows.map((r) => [r.ten || "MỚI", ...r.phu_thuoc_step_keys.map((k) => ten.get(k) ?? k)]);
}

describe("chenBuoc", () => {
  it("chèn vào GIỮA thì cắt cạnh cũ và nối A → MỚI → B", () => {
    expect(day(chenBuoc(chuoiThang(), 1, emptyRow()))).toEqual([
      ["A"], ["MỚI", "A"], ["B", "MỚI"], ["C", "B"],
    ]);
  });

  it("chèn lên ĐẦU chuỗi thì bước cũ đứng đầu nhận bước mới làm tiền nhiệm", () => {
    expect(day(chenBuoc(chuoiThang(), 0, emptyRow()))).toEqual([
      ["MỚI"], ["A", "MỚI"], ["B", "A"], ["C", "B"],
    ]);
  });

  it("chèn ở CUỐI thì treo vào bước cuối, không còn đứng mồ côi", () => {
    expect(day(chenBuoc(chuoiThang(), 3, emptyRow()))).toEqual([
      ["A"], ["B", "A"], ["C", "B"], ["MỚI", "C"],
    ]);
  });

  it("bước sau KHÔNG phụ thuộc bước trước thì KHÔNG bịa cạnh mới cho nó", () => {
    // Hai nhánh rời (B tự đứng đầu một nhánh). Chèn vào giữa chỉ được treo bước mới vào A —
    // tự nối A → MỚI → B là sửa DAG sau lưng người dùng.
    const roi = [dong({ ten: "A", key: "ka" }), dong({ ten: "B", key: "kb" })];
    expect(day(chenBuoc(roi, 1, emptyRow()))).toEqual([["A"], ["MỚI", "A"], ["B"]]);
  });

  it("giữ nguyên các tiền nhiệm KHÁC của bước sau (nhánh song song / cạnh xuyên LSX)", () => {
    const rows = [
      dong({ ten: "A", key: "ka" }),
      dong({ ten: "B", key: "kb", phu_thuoc_step_keys: ["ka", "ngoai"] }),
    ];
    expect(day(chenBuoc(rows, 1, emptyRow()))).toEqual([
      ["A"], ["MỚI", "A"], ["B", "MỚI", "ngoai"],
    ]);
  });

  it("chuỗi RỖNG thì bước đầu tiên không có tiền nhiệm", () => {
    expect(day(chenBuoc([], 0, emptyRow()))).toEqual([["MỚI"]]);
  });
});

describe("boBuoc", () => {
  it("bỏ bước GIỮA thì bắc cầu A → C, không để lại key mồ côi", () => {
    expect(day(boBuoc(chuoiThang(), 1))).toEqual([["A"], ["C", "A"]]);
  });

  it("bỏ bước ĐẦU thì bước kế tiếp thành đầu chuỗi", () => {
    expect(day(boBuoc(chuoiThang(), 0))).toEqual([["B"], ["C", "B"]]);
  });

  it("bắc cầu KHÔNG đẻ tiền nhiệm trùng khi bước sau đã phụ thuộc sẵn", () => {
    // C phụ thuộc cả B lẫn A; bỏ B thì cầu A của B trùng với A sẵn có.
    const rows = [
      dong({ ten: "A", key: "ka" }),
      dong({ ten: "B", key: "kb", phu_thuoc_step_keys: ["ka"] }),
      dong({ ten: "C", key: "kc", phu_thuoc_step_keys: ["kb", "ka"] }),
    ];
    expect(day(boBuoc(rows, 1))).toEqual([["A"], ["C", "A"]]);
  });

  it("bắc cầu KHÔNG biến bước thành tự phụ thuộc chính nó", () => {
    // Ca vòng do người dùng nối tay: B phụ thuộc C, C phụ thuộc B. Bỏ B thì cầu trả về chính C.
    const rows = [
      dong({ ten: "B", key: "kb", phu_thuoc_step_keys: ["kc"] }),
      dong({ ten: "C", key: "kc", phu_thuoc_step_keys: ["kb"] }),
    ];
    expect(day(boBuoc(rows, 0))).toEqual([["C"]]);
  });
});

describe("toBody — số lượt qua máy", () => {
  // 08/09/2026, chủ chốt: "loại bước là tổ thì ẩn cái này đi và cho mặc định là 1". Ô đã gỡ khỏi
  // drawer ở bước tổ, nên số 2 lượt còn sót của bước máy cũ KHÔNG được nằm lại vô hình trong DB —
  // chip `so_luot_chay` của công thức tiền công đọc thẳng cột này.
  it("bước TỔ luôn gửi 1 lượt dù dòng còn giữ số cũ", () => {
    const [body] = toBody([dong({ ten: "Dán hộp", loai_buoc: "to", so_luot_chay: "2" })]);
    expect(body.so_luot_chay).toBe(1);
  });

  it("bước MÁY vẫn gửi đúng số đã khai", () => {
    const [body] = toBody([dong({ ten: "In offset", loai_buoc: "may", so_luot_chay: "2" })]);
    expect(body.so_luot_chay).toBe(2);
  });
});

describe("toBody — dòng giấy dẫn xuất từ đầu vào của bước", () => {
  const mon = (hang_loai: "giay" | "vat_tu", kho_rong: string, kho_dai: string) => ({
    hang_loai, vat_tu_id: 7, vat_tu_ma: "M", vat_tu_ten: "Món", don_vi: "to_nguyen",
    so_luong: "5000", tu_dong: false, kho_rong, kho_dai,
  });

  it("dòng giấy chỉ gửi MÃ (số + khổ máy chủ tự ghi); dòng vật tư không gửi khổ", () => {
    const [body] = toBody([dong({ ten: "In offset", vat_tus: [
      mon("giay", "905", "780"), mon("vat_tu", "", "")] })]);
    expect(body.vat_tus).toEqual([
      { hang_loai: "giay", vat_tu_id: 7, so_luong: null, tu_dong: false, kho_rong: 0, kho_dai: 0 },
      { hang_loai: "vat_tu", vat_tu_id: 7, tu_dong: false, gia_tri_chip: {} },
    ]);
  });
});

describe("toBody — vật tư khác giấy", () => {
  it("vật tư khác gửi chip, KHÔNG gửi so_luong; giấy gửi so_luong null", () => {
    const r = { ...emptyRow(), vat_tus: [
      { hang_loai: "vat_tu", vat_tu_id: 1, so_luong: "0.2", tu_dong: true, gia_tri_chip: { dai_support: 500 }, chips: [] },
      { hang_loai: "giay", vat_tu_id: 9, so_luong: "10", tu_dong: false, kho_rong: "0", kho_dai: "0" },
    ] } as never;
    const body = toBody([r])[0];
    expect(body.vat_tus![0]).toEqual({ hang_loai: "vat_tu", vat_tu_id: 1, tu_dong: true, gia_tri_chip: { dai_support: 500 } });
    expect(body.vat_tus![1].so_luong).toBeNull();
  });
  it("dòng người đã gõ định mức gửi kèm so_luong + sua_tay", () => {
    const r = { ...emptyRow(), vat_tus: [
      { hang_loai: "vat_tu", vat_tu_id: 1, so_luong: "12.5", tu_dong: true, sua_tay: true, gia_tri_chip: {}, chips: [] },
    ] } as never;
    expect(toBody([r])[0].vat_tus![0]).toEqual(
      { hang_loai: "vat_tu", vat_tu_id: 1, tu_dong: false, sua_tay: true, so_luong: 12.5, gia_tri_chip: {} });
  });
});

describe("nhanGiayTheoDauVao", () => {
  it("nhãn bộ chọn theo đầu vào của bước", () => {
    expect(nhanGiayTheoDauVao("to", "kg")).toBe("tờ in");
    expect(nhanGiayTheoDauVao("to_nguyen", "kg")).toBe("tờ nguyên");
    // Bước nhận giấy khổ rộng: khổ + đơn vị của mã, không còn chữ "cuộn".
    expect(nhanGiayTheoDauVao("kg", "kg", 1000)).toBe("khổ 1000 mm (kg)");
    expect(nhanGiayTheoDauVao("kg", "kg")).toBe("kg");
    expect(nhanGiayTheoDauVao(null, "tấn")).toBe("");
    expect(nhanGiayTheoDauVao("", "kg")).toBe("");
    expect(nhanGiayTheoDauVao("cai", "kg")).toBe("");
  });
});

describe("dòng giấy là số MÁY tính", () => {
  it("giấy luôn là Tự tính, kể cả dòng người lập lệnh tự chọn (tu_dong=false)", () => {
    expect(laMayTinh({ hang_loai: "giay", sua_tay: true })).toBe(true);
    expect(laMayTinh({ hang_loai: "vat_tu", sua_tay: false })).toBe(true);
    expect(laMayTinh({ hang_loai: "vat_tu", sua_tay: true })).toBe(false);
  });
  it("giấy chưa có đơn vị gốc = chờ lưu; đã dẫn xuất hoặc vật tư khác thì không", () => {
    expect(giayChoLuu({ hang_loai: "giay", don_vi_goc: "" })).toBe(true);
    expect(giayChoLuu({ hang_loai: "giay" })).toBe(true);
    expect(giayChoLuu({ hang_loai: "giay", don_vi_goc: "to" })).toBe(false);
    expect(giayChoLuu({ hang_loai: "vat_tu" })).toBe(false);
  });
});

// Lỗi #15 (E2E 18/10/2026): ▲▼ chỉ dời dòng, Be thu vẫn ghi tiền nhiệm "Cán màng" nằm SAU nó.
describe("doiChoBuoc", () => {
  it("tuyến thẳng: dời bước thì nối lại tiền nhiệm theo thứ tự mới", () => {
    expect(day(doiChoBuoc(chuoiThang(), 2, 1))).toEqual([["A"], ["C", "A"], ["B", "C"]]);
  });

  it("tuyến thẳng: dời bước đầu xuống thì bước kế thành đầu chuỗi", () => {
    expect(day(doiChoBuoc(chuoiThang(), 0, 1))).toEqual([["B"], ["A", "B"], ["C", "A"]]);
  });

  it("giữ tiền nhiệm ngoài bảng (cạnh xuyên lệnh) khi nối lại", () => {
    const rows = [
      dong({ ten: "A", key: "ka" }),
      dong({ ten: "B", key: "kb", phu_thuoc_step_keys: ["ka", "ngoai"] }),
      dong({ ten: "C", key: "kc", phu_thuoc_step_keys: ["kb"] }),
    ];
    expect(day(doiChoBuoc(rows, 2, 1))).toEqual([["A"], ["C", "A"], ["B", "C", "ngoai"]]);
  });

  it("tuyến rẽ nhánh: chỉ dời dòng, không tự sửa phụ thuộc (máy chủ chặn nếu ngược)", () => {
    const rows = [
      dong({ ten: "A", key: "ka" }),
      dong({ ten: "B", key: "kb", phu_thuoc_step_keys: ["ka"] }),
      dong({ ten: "C", key: "kc", phu_thuoc_step_keys: ["ka"] }),
    ];
    expect(day(doiChoBuoc(rows, 2, 1))).toEqual([["A"], ["C", "A"], ["B", "A"]]);
  });

  it("chỉ số ngoài bảng thì giữ nguyên", () => {
    const rows = chuoiThang();
    expect(doiChoBuoc(rows, 0, -1)).toBe(rows);
  });
});

describe("lyDoChanLuu (#15: ô lý do bắt buộc khi tuyến khác bài tính giá)", () => {
  it("đổi cấu trúc mà lý do trống thì chặn, nói rõ cần gì", () => {
    expect(lyDoChanLuu(true, "  ")).toBe("Ghi lý do đổi công đoạn rồi mới lưu được");
  });
  it("có lý do, hoặc không đổi cấu trúc, thì lưu được", () => {
    expect(lyDoChanLuu(true, "khách đổi cán thuê ngoài")).toBeNull();
    expect(lyDoChanLuu(false, "")).toBeNull();
  });
});

describe("donViChuoi · chặng tờ nguyên (#66)", () => {
  it("routing không có bước xả thì giấy nguyên ghi 'tờ nguyên', KHÔNG mượn nhãn 'tờ in'", () => {
    const dv = donViChuoi({ don_vi_to: "to", don_vi_to_nguyen: null });
    expect(dv.toNguyen).toBe("tờ nguyên");
    expect(dv.toNguyen).not.toContain("tờ in");
  });
});

describe("tickConLaCuaNguoiKhac · banner 'Có thay đổi mới' (#65)", () => {
  const T0 = 1_000_000;
  it("sự kiện SSE về ngay sau thao tác của chính mình thì coi là đã xem", () => {
    expect(tickConLaCuaNguoiKhac(5, 4, T0, T0 + 500)).toBe(false);
    expect(tickConLaCuaNguoiKhac(5, 4, T0, T0 + CUA_SO_TU_LAM_MS)).toBe(false);
  });
  it("sự kiện về khi mình không vừa thao tác (người khác đổi) thì vẫn báo", () => {
    expect(tickConLaCuaNguoiKhac(5, 4, T0, T0 + CUA_SO_TU_LAM_MS + 1)).toBe(true);
    expect(tickConLaCuaNguoiKhac(5, 4, 0, T0)).toBe(true);
  });
  it("tick không vượt mốc đã xem thì không báo", () => {
    expect(tickConLaCuaNguoiKhac(4, 4, 0, T0)).toBe(false);
  });
});

describe("bước đã bắt đầu + tổ khác của máy (23/10/2026)", () => {
  it("toEdit giữ cờ việc đã bắt đầu để ngăn bước khoá ô tổ/máy", () => {
    const cd = { step_key: "b1", id: 5, ten: "In", loai_buoc: "may", vat_tus: [] } as never;
    expect(toEdit({ ...(cd as object), da_bat_dau: true } as never).da_bat_dau).toBe(true);
    expect(toEdit(cd).da_bat_dau).toBe(false);
  });

  it("máy thuộc tổ đang chọn thì tổ khác là 'cũng thuộc'; máy không thuộc tổ đang chọn thì lệch", () => {
    expect(toKhacCuaMay([1, 2], 1)).toEqual({ khac: [2], lech: false });
    expect(toKhacCuaMay([2, 3], 1)).toEqual({ khac: [2, 3], lech: true });
    expect(toKhacCuaMay([1], 1)).toEqual({ khac: [], lech: false });
    expect(toKhacCuaMay([2], null)).toEqual({ khac: [2], lech: false });
    expect(toKhacCuaMay(null, 1)).toEqual({ khac: [], lech: false });
  });
});
