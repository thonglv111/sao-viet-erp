/** Dự báo tồn màn Tồn kho: trải lệnh sắp lĩnh + hàng về theo ngày, so ngưỡng, ra số đề nghị mua. */
import { describe, expect, it } from "vitest";

import type { DuBaoTonRow, StockThreshold } from "../../api/client";
import { ngayCanMua, tinhDuBao as tinhGoc } from "./duBao";

const HOM_NAY = "2026-10-07";
const tinhDuBao = (ton: number, du: DuBaoTonRow | undefined, th: StockThreshold | undefined) =>
  tinhGoc(ton, du, th, HOM_NAY);

const lenh = (ma: string, han: string | null, can: number) =>
  ({ ma, lsx_id: 1, bai_ghep_id: null, ten_viec: "In", khach_ten: null, han_giao: han, can, da_giu: 0 });
const row = (p: Partial<DuBaoTonRow>): DuBaoTonRow => ({
  hang_loai: "giay", hang_id: 5, kho_rong: 650, kho_dai: 860, ton_toan_xuong: null,
  can_lenh: 0, dang_ve: 0, lenh: [], ve: [], phieu_mua: [], ...p,
});
const nguong = (min: number, max: number | null): StockThreshold =>
  ({ id: 1, hang_loai: "giay", hang_id: 5, kho_id: 1, nguong_ton: min, nguong_toi_da: max, canh_bao: true } as StockThreshold);

describe("tinhDuBao", () => {
  it("số mẫu C: 3.200 − 2.400 = 800, dưới tối thiểu 4.000 ⇒ mua 6.200 về tối đa 7.000", () => {
    const d = tinhDuBao(3200, row({
      lenh: [lenh("LSX-0318", "2026-10-10", 1200), lenh("LSX-0322", "2026-10-15", 700), lenh("LSX-0327", "2026-10-21", 500)],
    }), nguong(4000, 7000));
    expect(d.duKien).toBe(800);
    expect(d.suKien.map((s) => s.conLai)).toEqual([2000, 1300, 800]);
    expect(d.canMua).toBe(true);
    expect(d.moc).toBe("nay"); // 3.200 đã dưới 4.000 ngay bây giờ
    expect(d.thieu).toBe(3200);
    expect(d.deNghi).toBe(6200);
    expect(d.dich).toEqual({ nhan: "Tối đa", so: 7000, day: false });
    expect(d.trangThai).toBe("can_mua");
    expect(d.suKien.map((s) => s.vung)).toEqual(["do", "do", "do"]);
  });

  it("cùng ngày thì lĩnh trước về sau; mốc rơi dưới ngưỡng là ngày lệnh làm thủng", () => {
    const d = tinhDuBao(5000, row({
      lenh: [lenh("A", "2026-10-12", 1500)],
      ve: [{ ma: "PMH-1", ngay_ve: "2026-10-12", sl: 1000 }],
    }), nguong(4000, null));
    expect(d.suKien.map((s) => s.loai)).toEqual(["lenh", "ve"]);
    expect(d.moc).toBe("2026-10-12");
    expect(d.duKien).toBe(4500);
    // Cuối chuỗi đã về trên ngưỡng nhưng GIỮA chừng rơi xuống 3.500 — lệnh lĩnh sáng 12/10 không
    // chờ được hàng về chiều ⇒ vẫn Cần mua, đề nghị đúng phần đỡ điểm thấp nhất.
    expect(d.canMua).toBe(true);
    expect(d.duoiCuoi).toBe(false);
    expect(d.thapNhat).toBe(3500);
    expect(d.deNghi).toBe(500);
    expect(d.dich).toEqual({ nhan: "Tối thiểu", so: 4000, day: true });
    expect(ngayCanMua(d, "2026-10-07")).toBe("2026-10-12");
  });

  it("Tối đa trống ⇒ mua về Tối thiểu; chạm đúng Tối thiểu là đã Cần mua", () => {
    const d = tinhDuBao(4000, row({}), nguong(4000, null));
    expect(d.canMua).toBe(true);
    expect(d.deNghi).toBe(0);
    expect(d.dich).toEqual({ nhan: "Tối thiểu", so: 4000, day: false });
  });

  it("chưa khai ngưỡng: chỉ báo khi lệnh lĩnh vượt tồn, đề nghị đúng phần thiếu", () => {
    const d = tinhDuBao(500, row({ lenh: [lenh("A", null, 800)] }), undefined);
    expect(d.duKien).toBe(-300);
    expect(d.canMua).toBe(true);
    expect(d.deNghi).toBe(300);
    expect(tinhDuBao(500, row({}), undefined).canMua).toBe(false);
  });

  it("đơn mua về dồn ⇒ Sẽ vượt tối đa từ ngày về, dư đúng phần trên tối đa", () => {
    const d = tinhDuBao(3000, row({
      lenh: [lenh("A", "2026-10-09", 500)],
      ve: [{ ma: "PMH-7", ngay_ve: "2026-10-14", sl: 4000 }],
    }), nguong(1000, 5000));
    expect(d.canMua).toBe(false);
    expect(d.trangThai).toBe("vuot");
    expect(d.mocVuot).toBe("2026-10-14");
    expect(d.caoNhat).toBe(6500);
    expect(d.duMax).toBe(1500);
    expect(d.suKien.map((s) => s.vung)).toEqual(["la", "cam"]);
  });

  it("việc đã quá hẹn gắn số ngày trễ và tính như xảy ra hôm nay", () => {
    const d = tinhDuBao(2000, row({
      lenh: [lenh("A", "2026-10-03", 1500)],
      ve: [{ ma: "PMH-2", ngay_ve: "2026-10-05", sl: 300 }],
    }), nguong(1000, 4000));
    expect(d.tre.map((s) => s.tre)).toEqual([4, 2]);
    expect(d.moc).toBe("nay"); // lệnh trễ làm thủng ⇒ thiếu từ hôm nay chứ không phải 03/10
    expect(d.thieu).toBe(500);
  });

  it("mốc đã qua hoặc 'nay' ⇒ ngày cần là hôm nay", () => {
    const d = tinhDuBao(100, row({ lenh: [lenh("A", "2026-10-01", 200)] }), undefined);
    expect(ngayCanMua(d, "2026-10-07")).toBe("2026-10-07");
  });
});
