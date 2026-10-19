import { describe, expect, it } from "vitest";
import { cauChuaTinhGio, goiDaThuHoi, soBuocChuaGio } from "./xlNganSo";

// Lỗi #24 bấm thử 18/10/2026: bước "Chưa tính được giờ" chiếm 0 phút trên lịch, ngày xong ra
// lạc quan mà đầu ngăn vẫn in nó như số chắc.
const b = (chay_phut: number, la_thue_ngoai = false) => ({ chay_phut, la_thue_ngoai });

describe("soBuocChuaGio", () => {
  it("đếm bước máy 0 phút, bỏ bước gia công ngoài", () => {
    expect(soBuocChuaGio([b(131), b(0), b(49), b(0, true)])).toBe(1);
  });
  it("đủ giờ thì 0", () => {
    expect(soBuocChuaGio([b(131), b(49)])).toBe(0);
  });
});

describe("cauChuaTinhGio", () => {
  it("nói rõ số bước và ngày xong chỉ là sớm nhất", () => {
    expect(cauChuaTinhGio(1)).toBe("Chưa tính được giờ ở 1 bước, ngày xong có thể muộn hơn.");
  });
  it("đủ giờ thì không có câu", () => {
    expect(cauChuaTinhGio(0)).toBeNull();
  });
});

// Lỗi #25: thu hồi rồi phát hành lại thì tab Lịch sử phát hành mất bản cũ và lý do thu hồi.
describe("goiDaThuHoi", () => {
  const pb = { so: 1, loai: "phat_hanh", ly_do: null, phat_hanh_by_id: 1, luc: "2026-10-18T08:38:00" };
  const song = { goi_id: 16, ma: "GPH26-0016", trang_thai: "dang_phat_hanh", thu_hoi_ly_do: null, thu_hoi_luc: null, phien_bans: [pb] };
  const cu = { goi_id: 15, ma: "GPH26-0015", trang_thai: "da_thu_hoi", thu_hoi_ly_do: "khách đổi quy cách", thu_hoi_luc: "2026-10-18T08:30:00", phien_bans: [pb] };
  it("bỏ gói đang sống, giữ gói đã thu hồi theo thứ tự máy chủ trả", () => {
    expect(goiDaThuHoi({ co_goi: true, goi_id: 16, lich_su_goi: [song, cu] }).map((g) => g.ma)).toEqual(["GPH26-0015"]);
  });
  it("lệnh chưa phát hành lại vẫn thấy gói cũ", () => {
    expect(goiDaThuHoi({ co_goi: false, lich_su_goi: [cu] }).map((g) => g.thu_hoi_ly_do)).toEqual(["khách đổi quy cách"]);
  });
  it("máy chủ cũ không trả lịch sử thì rỗng", () => {
    expect(goiDaThuHoi(null)).toEqual([]);
    expect(goiDaThuHoi({ co_goi: false })).toEqual([]);
  });
});
