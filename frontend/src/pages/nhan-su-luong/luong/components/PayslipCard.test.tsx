// Phiếu lương của khối Sản xuất / Giao hàng — HAI LƯƠNG (21/10/2026), ăn bên lớn.
//
// Khối SX (22/10/2026) chỉ có "Tăng ca khoán" (`tang_ca_khoan`), cộng ngoài phép so; Giao hàng có
// "Tăng ca theo giờ" (`tien_gio_tang_ca`) thuộc lương thời gian. Phần thêm làm nguyên ngày CN/lễ nằm
// trong `ot_pay` nhưng không phải tiền giờ ⇒ in dòng riêng.
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { PayrollLine, PayrollPeriod } from "../../../../api/client";
import { PayslipCard } from "./PayslipCard";

const KY: PayrollPeriod = {
  id: 3, year: 2026, month: 9, status: "draft", standard_cong: 26,
  locked_at: null, paid_at: null, paid_by: null,
};

function dong(o: Partial<PayrollLine>): PayrollLine {
  return {
    id: 1, period_id: 3, employee_id: 9, employee_code: "NV007", employee_name: "Giao Hàng test",
    department_name: "Giao hàng", payroll_group: null, bank_account: null, bank_name: null,
    is_probation: false, actual_cong: 26, standard_cong: 26, monthly_salary: 10_000_000,
    luong_cong: 10_000_000, chuyen_can: 0, allowance: 0, khoan: 0, ot_minutes: 210, ot_pay: 0,
    night_days: 0, night_pay: 0, vi_pham: 0, other_bonus: 0, gross: 10_000_000,
    insurance_base: 10_000_000, bhxh: 0, cong_doan: 0, pit: 0, advance_total: 0,
    net_pay: 10_000_000, note: null,
    ...o,
  } as PayrollLine;
}

function dongThu(nhan: string): HTMLElement {
  const td = screen.getByText(nhan);
  return td.closest("tr") as HTMLElement;
}

describe("Phiếu lương — hai lương, hai loại tăng ca", () => {
  it("⭐ ăn khoán, làm nguyên ngày Chủ nhật: Tăng ca theo giờ 0đ, số CN tách dòng riêng", () => {
    render(<PayslipCard period={KY}
                        line={dong({ che_do_khoan: true, ot_pay: 384_615, tien_gio_tang_ca: 0 })} />);
    expect(within(dongThu("Tăng ca theo giờ")).getByText("—")).toBeInTheDocument();
    expect(within(dongThu("Làm ngày Chủ nhật / lễ")).getByText("384.615")).toBeInTheDocument();
    expect(screen.queryByText("Tăng ca")).not.toBeInTheDocument();
  });

  it("khoán có ngày nghỉ off1x thì nhãn nói luôn 'ngày nghỉ 1×'", () => {
    render(<PayslipCard period={KY}
                        line={dong({ che_do_khoan: true, ot_pay: 500_000, off1x_pay: 500_000 })} />);
    expect(dongThu("Làm ngày Chủ nhật / lễ / ngày nghỉ 1×")).toBeInTheDocument();
  });

  it("⭐ ăn khoán có tăng ca khoán: in dòng 'Tăng ca khoán', không mọc dòng CN/lễ rỗng", () => {
    render(<PayslipCard period={KY}
                        line={dong({ che_do_khoan: true, ot_pay: 0, khoan: 9_000_000,
                                     tang_ca_khoan: 37_500, lay_bu_lo: false })} />);
    expect(within(dongThu("Tăng ca khoán")).getByText("37.500")).toBeInTheDocument();
    expect(screen.queryByText(/Làm ngày Chủ nhật/)).not.toBeInTheDocument();
  });

  it("⭐ khối SX ăn lương thời gian vẫn in 'Tăng ca khoán' — cộng ngoài phép so (22/10/2026)", () => {
    render(<PayslipCard period={KY}
                        line={dong({ che_do_khoan: true, ot_pay: 0, tien_gio_tang_ca: 0,
                                     khoan: 14_147_394, luong_cong: 1_083_375,
                                     bu_lo_theo_cong: 15_230_769, tang_ca_khoan: 500_000,
                                     lay_bu_lo: true })} />);
    expect(within(dongThu("Tăng ca khoán")).getByText("500.000")).toBeInTheDocument();
  });

  it("⭐ ăn lương thời gian: tiền giờ tăng ca in ở 'Tăng ca theo giờ', phần CN tách riêng", () => {
    render(
      <PayslipCard
        period={KY}
        line={dong({ che_do_khoan: true, la_giao_hang: true, lay_bu_lo: true,
                     ot_pay: 5_490_865, tien_gio_tang_ca: 5_000_000 })}
      />,
    );
    expect(within(dongThu("Tăng ca theo giờ")).getByText("5.000.000")).toBeInTheDocument();
    expect(within(dongThu("Làm ngày Chủ nhật / lễ")).getByText("490.865")).toBeInTheDocument();
    expect(screen.queryByText("Tăng ca khoán")).not.toBeInTheDocument();
  });

  it("người KHÔNG ăn khoán: vẫn một dòng 'Tăng ca' mang đủ tiền như cũ", () => {
    render(<PayslipCard period={KY} line={dong({ che_do_khoan: false, ot_pay: 252_404 })} />);
    const tangCa = dongThu("Tăng ca");
    expect(within(tangCa).getByText("252.404")).toBeInTheDocument();
    expect(screen.queryByText(/khoán — không có tiền tăng ca/)).not.toBeInTheDocument();
  });
});

// LƯƠNG BÙ LỖ (tổ khoán sản xuất, 14/09/2026): lương sản lượng = MAX(khoán, bù lỗ theo công). Dòng
// lương ghi `luong_cong` = PHẦN BÙ THÊM ⇒ phiếu KHÔNG được in "Lương theo công" (đọc thành ăn cả hai),
// và số bù lỗ đem so chỉ là dòng phụ, không cộng vào TỔNG THU.
describe("Phiếu lương — luật bù lỗ tổ khoán", () => {
  function tongThu(): string {
    const so = within(dongThu("TỔNG THU")).getAllByText(/\d/);
    return so[so.length - 1].textContent ?? "";
  }

  it("⭐ khoán cao hơn: chỉ tiền khoán vào tổng, bù lỗ in dòng phụ 'lấy khoán', không có lương theo công", () => {
    render(
      <PayslipCard
        period={KY}
        line={dong({
          che_do_khoan: true, luong_cong: 0, khoan: 20_157_390,
          bu_lo_theo_cong: 7_338_462, lay_bu_lo: false,
        })}
      />,
    );
    expect(screen.queryByText("Lương theo công")).not.toBeInTheDocument();
    expect(within(dongThu("Lương khoán / sản lượng")).getByText("20.157.390")).toBeInTheDocument();
    const so = dongThu("Đem so: lương thời gian (theo công gồm phụ cấp + tăng ca theo giờ) — thấp hơn → ăn khoán");
    expect(within(so).getByText("7.338.462")).toBeInTheDocument();
    expect(screen.queryByText("Lương bù lỗ theo công")).not.toBeInTheDocument();
    expect(tongThu()).toBe("20.157.390");
  });

  it("⭐ khoán thấp hơn: MỘT dòng 'Lương bù lỗ theo công', KHÔNG in dòng khoán nữa", () => {
    // Chủ chốt 16/09/2026: *"đã lấy bù lỗ rồi thì không cần hiển thị khoán nữa"* — in cả khoán lẫn
    // phần bù thêm thì người nhận đọc thành cộng dồn (6.000.000 + 1.338.462), trong khi hai khoản
    // THAY NHAU. Tổng thu không đổi: 6.000.000 + 1.338.462 = 7.338.462 = đúng bù lỗ.
    render(
      <PayslipCard
        period={KY}
        line={dong({
          che_do_khoan: true, luong_cong: 1_338_462, khoan: 6_000_000,
          bu_lo_theo_cong: 7_338_462, lay_bu_lo: true,
        })}
      />,
    );
    expect(within(dongThu("Lương bù lỗ theo công")).getByText("7.338.462")).toBeInTheDocument();
    expect(screen.queryByText("Lương khoán / sản lượng")).not.toBeInTheDocument();
    expect(screen.queryByText("Bù thêm cho đủ lương bù lỗ")).not.toBeInTheDocument();
    expect(screen.queryByText(/Đem so: lương thời gian/)).not.toBeInTheDocument();
    expect(tongThu()).toBe("7.338.462");
  });

  it("⭐ tài xế lấy bù lỗ: gộp tiền km vào dòng bù lỗ, không in dòng 'Khoán km giao hàng'", () => {
    render(
      <PayslipCard
        period={KY}
        line={dong({
          che_do_khoan: true, luong_cong: 5_500_000, khoan: 0, khoan_km: 8_000_000,
          bu_lo_theo_cong: 13_500_000, lay_bu_lo: true,
        })}
      />,
    );
    expect(within(dongThu("Lương bù lỗ theo công")).getByText("13.500.000")).toBeInTheDocument();
    expect(screen.queryByText("Khoán km giao hàng")).not.toBeInTheDocument();
    expect(tongThu()).toBe("13.500.000");
  });

  it("tài xế (15/09): lương theo công 0 ghi rõ 'ăn theo km — không có', không có dòng bù lỗ", () => {
    render(
      <PayslipCard
        period={KY}
        line={dong({ che_do_khoan: true, luong_cong: 0, khoan: 0, khoan_km: 20_000_000 })}
      />,
    );
    const lc = dongThu("Lương theo công (tài xế ăn theo km — không có)");
    expect(within(lc).getByText("—")).toBeInTheDocument();
    expect(within(dongThu("Khoán km giao hàng")).getByText("20.000.000")).toBeInTheDocument();
    expect(screen.queryByText(/Đem so: lương thời gian/)).not.toBeInTheDocument();
    expect(screen.queryByText("Bù thêm cho đủ lương bù lỗ")).not.toBeInTheDocument();
    expect(tongThu()).toBe("20.000.000");
  });

  it("⭐ công ngày lễ nghỉ (15/09): dòng riêng 'Công ngày lễ (ngoài khoán)' CÓ vào tổng thu", () => {
    render(
      <PayslipCard
        period={KY}
        line={dong({
          che_do_khoan: true, luong_cong: 0, khoan: 20_157_390, luong_ngay_le: 553_846,
          bu_lo_theo_cong: 6_646_154, lay_bu_lo: false,
        })}
      />,
    );
    expect(within(dongThu("Công ngày lễ (ngoài khoán)")).getByText("553.846")).toBeInTheDocument();
    expect(tongThu()).toBe("20.711.236");
  });

  it("cả kỳ chỉ có công lễ (bù lỗ 0, khoán 0): không in dòng 'Đem so … lấy khoán'", () => {
    render(
      <PayslipCard
        period={KY}
        line={dong({
          che_do_khoan: true, luong_cong: 0, khoan: 0, luong_ngay_le: 500_000,
          bu_lo_theo_cong: 0, lay_bu_lo: false,
        })}
      />,
    );
    expect(screen.queryByText(/Đem so: lương thời gian/)).not.toBeInTheDocument();
    expect(within(dongThu("Công ngày lễ (ngoài khoán)")).getByText("500.000")).toBeInTheDocument();
    expect(tongThu()).toBe("500.000");
  });

  it("⭐ tiền ngày lễ / Chủ nhật của thợ khoán ghi SỐ NGÀY và đứng liền nhau", () => {
    render(
      <PayslipCard
        period={KY}
        line={dong({
          che_do_khoan: true, luong_cong: 0, khoan: 20_000_000,
          bu_lo_theo_cong: 6_000_000, lay_bu_lo: false,
          ot_pay: 553_846, special_cong: 2, luong_ngay_le: 276_923, le_nghi_cong: 1,
        })}
      />,
    );
    const cn = dongThu("Làm ngày Chủ nhật / lễ (2 công)");
    expect(within(cn).getByText("553.846")).toBeInTheDocument();
    const le = dongThu("Công ngày lễ (ngoài khoán) (1 ngày)");
    expect(within(le).getByText("276.923")).toBeInTheDocument();
    expect(cn.nextElementSibling).toBe(le);
    expect(tongThu()).toBe("20.830.769");
  });

  it("⭐ phụ cấp đi theo công (15/09): dòng phụ ghi mức tháng và số công, không cộng vào tổng", () => {
    render(
      <PayslipCard
        period={KY}
        line={dong({
          luong_cong: 9_230_769, allowance: 442_308, phu_cap_thang: 500_000, cong_phu_cap: 23,
        })}
      />,
    );
    expect(within(dongThu("Phụ cấp khác")).getByText("442.308")).toBeInTheDocument();
    const sub = dongThu("Theo công: phụ cấp tháng (kể cả khoản hồ sơ) ÷ 26 × 23 công");
    expect(within(sub).getByText("500.000")).toBeInTheDocument();
    expect(tongThu()).toBe("9.673.077");
  });

  it("không có công lễ tách riêng thì không mọc dòng 0đ", () => {
    render(<PayslipCard period={KY} line={dong({ che_do_khoan: true, khoan: 500_000 })} />);
    expect(screen.queryByText("Công ngày lễ (ngoài khoán)")).not.toBeInTheDocument();
  });

  it("dòng không thuộc luật bù lỗ: vẫn in 'Lương theo công' như cũ", () => {
    render(<PayslipCard period={KY} line={dong({ che_do_khoan: true, khoan: 500_000 })} />);
    expect(within(dongThu("Lương theo công")).getByText("10.000.000")).toBeInTheDocument();
    expect(screen.queryByText("Bù thêm cho đủ lương bù lỗ")).not.toBeInTheDocument();
    expect(screen.queryByText(/Đem so: lương thời gian/)).not.toBeInTheDocument();
  });
});
