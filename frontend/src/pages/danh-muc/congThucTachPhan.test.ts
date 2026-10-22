import { describe, expect, it } from "vitest";

import { tinhDong, tinhDongDoan } from "./congThucBacThang";
import { apPhanChung, chuPhan, nhomDong, phanChung, tachPhan } from "./congThucTachPhan";

const t = (s: string) => s.split(/\s+/).filter(Boolean);

// Hình 1 (22/10/2026): công thức khoán thật của công đoạn in.
const KHOAN = t(`( ( 1 - chay_tiep ) * gia_co_dinh + max ( 0 , sl_ghi * ( 1 + tu_tro ) - ( 1 - chay_tiep ) * 3000 )
  * don_gia_khoan ) * if ( metaline > 0 , 3 , if ( muc_uv > 0 , 2 , 1 ) )`);

// Hình 2: giá riêng máy IN-02, 3 ngưỡng SL vào — bậc 1 viết "150000 * so_kem", ba bậc sau đảo lại.
const bac = (a: string, b: string) =>
  `490000 * ( so_mau_in - so_mau_pha ) + ( sl_vao - 3000 ) * ( ${a} * ( so_mau_in - so_mau_pha ) + so_mau_pha * ${b} ) + so_mau_pha * 950000 + so_kem * 150000`;
const IN02 = t(`if ( sl_vao <= 3000 , 490000 * ( so_mau_in - so_mau_pha ) + so_mau_pha * 950000 + 150000 * so_kem ,
  if ( sl_vao <= 10000 , ${bac("130", "260")} , if ( sl_vao <= 20000 , ${bac("123", "250")} , ${bac("113", "230")} ) ) )`);

const veLayCua = (toks: string[], from = 0, to = toks.length) => {
  const g = nhomDong(tinhDongDoan(toks, from, to)).find((x) => x.loai === "bang");
  if (!g || g.loai !== "bang") throw new Error("không thành bảng");
  const bacs = g.bac.map((b) => b.khi[0].bac!);
  const cuoi = bacs[bacs.length - 1];
  return [...bacs.map((b) => ({ start: b.phay1 + 1, end: b.phay2 })), { start: cuoi.phay2 + 1, end: cuoi.close }];
};

describe("tách công thức thành phần (phương án C)", () => {
  it("công thức khoán ⇒ khung ( A + B ) × C, mỗi phần đúng đoạn token", () => {
    const r = tachPhan(KHOAN)!;
    expect(r.khung.map((m) => ("tok" in m ? KHOAN[m.tok] : chuPhan(m.phan))).join(" ")).toBe("( A + B ) * C");
    expect(r.phan.map((p) => KHOAN.slice(p.start, p.end).join(" "))).toEqual([
      "( 1 - chay_tiep ) * gia_co_dinh",
      "max ( 0 , sl_ghi * ( 1 + tu_tro ) - ( 1 - chay_tiep ) * 3000 ) * don_gia_khoan",
      "if ( metaline > 0 , 3 , if ( muc_uv > 0 , 2 , 1 ) )",
    ]);
  });

  it("thêm + D vào cuối ⇒ vẫn ( A + B ) × C + D, không gộp lại; phần cuối được rỗng lúc vừa bấm thêm", () => {
    const r = tachPhan([...KHOAN, "+", "x"])!;
    expect(r.khung.map((m) => ("tok" in m ? KHOAN.concat("+")[m.tok] : chuPhan(m.phan))).join(" "))
      .toBe("( A + B ) * C + D");
    const rong = tachPhan([...KHOAN, "+"])!;
    expect(rong.phan[3]).toEqual({ start: KHOAN.length + 1, end: KHOAN.length + 1 });
  });

  it("( 1 - chay_tiep ) ngắn không bị mở ngoặc cắt vụn", () => {
    expect(tachPhan(KHOAN)!.phan[0]).toEqual({ start: 1, end: 8 });
  });

  it("công thức ngắn, hay cả công thức là một if ⇒ không tách", () => {
    expect(tachPhan(t("dai_in * rong_in + 2"))).toBeNull();
    expect(tachPhan(IN02)).toBeNull();
  });

  it("dấu trừ đơn không phải chỗ cắt", () => {
    const r = tachPhan(t("- a * ( b + c ) + d * e - f * g + h * k + 1"), 1)!;
    expect(r.phan.map((p) => p.start)).toEqual([0, 9, 13, 17, 21]);
  });
});

describe("bảng Khi | Lấy", () => {
  it("chuỗi if đứng đầu dòng ⇒ một bảng: 3 bậc, còn lại, dòng ngoặc đóng", () => {
    const g = nhomDong(tinhDong(IN02));
    expect(g).toHaveLength(1);
    const b = g[0];
    if (b.loai !== "bang") throw new Error();
    expect(b.bac).toHaveLength(3);
    expect(b.conLai).toHaveLength(1);
    expect(b.dong && IN02.slice(b.dong.start, b.dong.end).join(" ")).toBe(") ) )");
  });

  it("if giữa phép tính (có phần đứng trước trên cùng dòng) ⇒ không kẻ bảng", () => {
    expect(nhomDong(tinhDong(t("700000 + if ( a , 1 , 2 )"))).every((x) => x.loai === "dong")).toBe(true);
  });

  it("phần C của công thức khoán vẽ thành bảng", () => {
    const p = tachPhan(KHOAN)!.phan[2];
    const g = nhomDong(tinhDongDoan(KHOAN, p.start, p.end));
    expect(g[0].loai).toBe("bang");
  });
});

describe("phần chung P của các bậc", () => {
  it("gom 3 số hạng có ở mọi bậc, hiểu 150000 × kẽm ≡ kẽm × 150000", () => {
    const pc = phanChung(IN02, veLayCua(IN02))!;
    expect(pc.mau.join(" ")).toBe("490000 * ( so_mau_in - so_mau_pha ) + so_mau_pha * 950000 + 150000 * so_kem");
    expect(pc.rieng[0]).toEqual([]);
    expect(pc.rieng.slice(1).map((r) => r.length)).toEqual([1, 1, 1]);
  });

  it("các vế không có gì chung (×3 / ×2 / ×1) ⇒ không có P", () => {
    const c = tachPhan(KHOAN)!.phan[2];
    expect(phanChung(KHOAN, veLayCua(KHOAN, c.start, c.end))).toBeNull();
  });

  it("sửa P ⇒ mọi bậc đổi theo, phần riêng giữ nguyên", () => {
    const ve = veLayCua(IN02);
    const pc = phanChung(IN02, ve)!;
    const moi = t("490000 * ( so_mau_in - so_mau_pha ) + so_mau_pha * 960000 + so_kem * 150000");
    const r = apPhanChung(IN02, ve, pc, moi);
    if ("loi" in r) throw new Error(r.loi);
    const s = r.toks.join(" ");
    expect(s.match(/960000/g)).toHaveLength(4);
    expect(s).not.toContain("950000");
    expect(s).toContain("so_kem * 150000 + ( sl_vao - 3000 ) * ( 113");
  });

  it("P rỗng mà có bậc chỉ gồm phần chung ⇒ báo lỗi, không ghi", () => {
    const ve = veLayCua(IN02);
    expect(apPhanChung(IN02, ve, phanChung(IN02, ve)!, [])).toHaveProperty("loi");
  });
});
