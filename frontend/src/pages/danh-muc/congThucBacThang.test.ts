import { describe, expect, it } from "vitest";

import {
  inDangChu, kiemCongThuc, nhanDoiBac, noiGon, nhomNghin, timBac, tinhDong, viTriToken, xoaBac,
} from "./congThucBacThang";

const HAM = ["ceil", "floor", "round", "max", "min", "if"];
const t = (s: string) => s.split(" ").filter(Boolean);
/** Mỗi dòng → [cấp, chuỗi token, nhãn] — đọc ra đúng hình người khai nhìn thấy. */
const hinh = (s: string) => {
  const toks = t(s);
  return tinhDong(toks).map((d) => [d.cap, toks.slice(d.start, d.end).join(" "), d.nhan ?? ""]);
};

// Công thức thật của "Bài in 1 màu hoặc 2 màu", máy in 2 màu — 4 bậc (29/09/2026).
const BA_BAC =
  "if ( sl_vao <= 3000 , A , if ( sl_vao <= 10000 , B , if ( sl_vao <= 20000 , C , D ) ) )";

describe("tinhDong — bậc thang", () => {
  it("chuỗi else-if thẳng MỘT cột, ngoặc đóng gom một dòng", () => {
    expect(hinh(BA_BAC)).toEqual([
      [0, "if ( sl_vao <= 3000 ,", "điều kiện 1"],
      [1, "A ,", "nếu đúng"],
      [0, "if ( sl_vao <= 10000 ,", "điều kiện 2"],
      [1, "B ,", "nếu đúng"],
      [0, "if ( sl_vao <= 20000 ,", "điều kiện 3"],
      [1, "C ,", "nếu đúng"],
      [1, "D", "còn lại"],
      [0, ") ) )", ""],
    ]);
  });

  it("if đơn: nhãn điều kiện / nếu đúng / nếu sai", () => {
    expect(hinh("if ( a > 1 , b , c )")).toEqual([
      [0, "if ( a > 1 ,", "điều kiện"],
      [1, "b ,", "nếu đúng"],
      [1, "c", "nếu sai"],
      [0, ")", ""],
    ]);
  });

  it("if ở vế NẾU ĐÚNG vẫn thụt thêm một cấp (không phải chuỗi else-if)", () => {
    const h = hinh("if ( a , if ( b , c , d ) , e )");
    expect(h[1]).toEqual([1, "if ( b ,", "nếu đúng"]);
    expect(h[2]).toEqual([2, "c ,", "nếu đúng"]);
  });

  it("if giữa phép tính: giữ nguyên phần đứng trước trên cùng dòng, không làm phẳng", () => {
    const h = hinh("700000 + if ( a , b , if ( c , d , e ) ) * 2");
    expect(h[0]).toEqual([0, "700000 + if ( a ,", "điều kiện 1"]);
    expect(h[h.length - 1]).toEqual([0, ") ) * 2", ""]);
  });

  it("tham số thứ ba có thêm phép tính ngoài if ⇒ KHÔNG làm phẳng", () => {
    const h = hinh("if ( a , b , if ( c , d , e ) + 1 )");
    expect(h.find((d) => d[1] === "if ( c ,")?.[0]).toBe(1);
  });

  it("max/min giữ cách thụt cũ", () => {
    expect(hinh("max ( a , b )")).toEqual([[0, "max (", ""], [1, "a ,", ""], [1, "b", ""], [0, ")", ""]]);
  });

  it("công thức thiếu ngoặc vẫn phủ kín mọi token, đúng thứ tự", () => {
    for (const s of ["if ( a , b", "if ( a , b , if ( c", "( ( a", "a ) ) b", "if (", "max ( a , if ( b , c , d )"]) {
      const toks = t(s);
      const dong = tinhDong(toks);
      expect(dong.map((d) => toks.slice(d.start, d.end).join(" ")).join(" ")).toBe(s);
      dong.forEach((d, i) => { if (i) expect(d.start).toBe(dong[i - 1].end); });
    }
  });
});

describe("thao tác theo bậc", () => {
  const toks = t(BA_BAC);
  const bac = [...timBac(toks).values()];

  it("tìm đủ 3 bậc", () => {
    expect(bac.map((b) => toks[b.phay1 - 1])).toEqual(["3000", "10000", "20000"]);
  });

  it("nhân đôi bậc giữa ⇒ bản sao ngay dưới, ngoặc cân, kiểm không lỗi", () => {
    const moi = nhanDoiBac(toks, bac[1]);
    expect(moi.join(" ")).toBe(
      "if ( sl_vao <= 3000 , A , if ( sl_vao <= 10000 , B , if ( sl_vao <= 10000 , B , "
      + "if ( sl_vao <= 20000 , C , D ) ) ) )");
    expect(kiemCongThuc(moi, null, HAM).loi).toBeNull();
    expect(timBac(moi).size).toBe(4);
  });

  it("xoá bậc đầu / giữa / cuối ⇒ các bậc còn lại giữ nguyên, vế còn lại đứng yên", () => {
    expect(xoaBac(toks, bac[0]).join(" ")).toBe(
      "if ( sl_vao <= 10000 , B , if ( sl_vao <= 20000 , C , D ) )");
    expect(xoaBac(toks, bac[1]).join(" ")).toBe(
      "if ( sl_vao <= 3000 , A , if ( sl_vao <= 20000 , C , D ) )");
    expect(xoaBac(toks, bac[2]).join(" ")).toBe(
      "if ( sl_vao <= 3000 , A , if ( sl_vao <= 10000 , B , D ) )");
  });

  it("xoá bậc của if đơn ⇒ còn trơ vế nếu sai", () => {
    const a = t("2 * if ( x , y , z ) + 1");
    expect(xoaBac(a, [...timBac(a).values()][0]).join(" ")).toBe("2 * z + 1");
  });
});

describe("Dạng chữ", () => {
  it("in gọn kiểu Excel, xuống dòng đúng hình bậc thang", () => {
    expect(inDangChu(t("if ( a <= 3000 , b * 2 , - 1 )"), HAM)).toBe(
      "if(a <= 3000,\n  b * 2,\n  -1\n)");
  });

  it("khứ hồi: chữ → token → nối một dấu cách ra đúng chuỗi lưu ban đầu", () => {
    const chu = inDangChu(t(BA_BAC), HAM);
    const lai = viTriToken(chu).map((x) => x.tok).join(" ");
    expect(lai).toBe(BA_BAC);
  });

  it("noiGon: tên hàm dính ngoặc, không cách quanh phẩy", () => {
    expect(noiGon(t("max ( a , b ) + ( c - d )"), HAM)).toBe("max(a, b) + (c - d)");
  });
});

describe("kiemCongThuc — chỉ báo, không tự sửa", () => {
  it("dấu ; của Excel tiếng Việt ⇒ báo đúng token, bảo dùng dấu phẩy", () => {
    const r = kiemCongThuc(viTriToken("if(a;b;c)").map((x) => x.tok), null, HAM);
    expect(r.loi).toMatch(/dấu phẩy/);
    expect(r.idx).toBe(3);
  });

  it("IF viết hoa ⇒ bảo viết thường", () => {
    expect(kiemCongThuc(t("IF ( a , b , c )"), null, HAM).loi).toMatch(/Viết thường: "if"/);
  });

  it("ký tự lạ (≤) không bị nuốt — báo không đọc được", () => {
    const toks = viTriToken("a ≤ 3").map((x) => x.tok);
    expect(toks).toEqual(["a", "≤", "3"]);
    expect(kiemCongThuc(toks, null, HAM)).toEqual({ loi: 'Ký tự "≤" không đọc được', idx: 1 });
  });

  it("700.000 ⇒ nhắc là 700, viết liền", () => {
    expect(kiemCongThuc(t("a * 700.000"), null, HAM).loi).toMatch(/được hiểu là 700 .*"700000"/);
    expect(kiemCongThuc(t("a * 1.5"), null, HAM).loi).toBeNull();
  });

  it("0.012 là số thập phân, không phải chấm nghìn — số nhóm nghìn không bắt đầu bằng 0", () => {
    expect(kiemCongThuc(t("a * 0.012"), null, HAM).loi).toBeNull();
    expect(kiemCongThuc(t("a * 0.004 * 47160"), null, HAM).loi).toBeNull();
    expect(kiemCongThuc(t("a * 1.200"), null, HAM).loi).toMatch(/được hiểu là 1.2/);
  });

  it("hai mục đứng liền không có dấu ⇒ báo thiếu dấu, chỉ vào mục sau", () => {
    expect(kiemCongThuc(t("a + 3 0"), null, HAM)).toEqual({ loi: 'Thiếu dấu giữa "3" và "0" — thêm + − × ÷ vào giữa', idx: 3 });
    expect(kiemCongThuc(t("( a + b ) 3"), null, HAM).loi).toMatch(/Thiếu dấu giữa "\)" và "3"/);
    expect(kiemCongThuc(t("max ( a , b ) * 2"), null, HAM).loi).toBeNull();
  });

  it("if thiếu vế / max một tham số", () => {
    expect(kiemCongThuc(t("if ( a , b )"), null, HAM).loi).toMatch(/đủ 3 phần .* đang có 2/);
    expect(kiemCongThuc(t("max ( a )"), null, HAM).loi).toMatch(/ít nhất 2/);
  });

  it("ngoặc thừa / thiếu chỉ đúng vị trí", () => {
    expect(kiemCongThuc(t("a ) + b"), null, HAM)).toEqual({ loi: "Thừa dấu đóng ngoặc", idx: 1 });
    expect(kiemCongThuc(t("( a + ( b )"), null, HAM)).toEqual({ loi: "Thiếu dấu đóng ngoặc", idx: 0 });
  });

  it("biến lạ khi có danh sách biến hợp lệ", () => {
    expect(kiemCongThuc(t("sl_vao * xyz"), ["sl_vao"], HAM)).toEqual({
      loi: 'Biến hoặc hàm "xyz" không được hỗ trợ trong hệ thống', idx: 2,
    });
  });
});

it("nhomNghin: khoảng trắng hẹp, không dấu chấm", () => {
  expect(nhomNghin("700000")).toBe("700 000");
  expect(nhomNghin("3000")).toBe("3 000");
  expect(nhomNghin("200")).toBe("200");
  expect(nhomNghin("12345.5")).toBe("12 345.5");
});
