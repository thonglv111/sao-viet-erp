/** Mảnh chung sổ phiếu gọn A: số phiếu của dòng Cộng phải KHỚP tổng tiền máy chủ cộng (tổng cộng
 *  trên bộ lọc có tab, còn `the_loc` đếm trên nền không có tab). */
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TaiKhoanO, soPhieuCong } from "./PhieuGon";

const N = { tat_ca: 9, xong: 6, xong_tien: 50_000_000, da_huy: 2, cho: 1 };

describe("soPhieuCong", () => {
  it("tab chỉ chứa phiếu đã xong (Đã chi / Đã thu): số dòng của bảng", () => {
    expect(soPhieuCong({ the: "xong", n: N, tong: 4 })).toBe(4);
  });

  it("tab Tất cả: số phiếu đã xong của the_loc", () => {
    expect(soPhieuCong({ the: "tat_ca", n: N, tong: 9 })).toBe(6);
  });

  it("tab không có phiếu đã xong hoặc chưa có số: null (không vẽ dòng Cộng)", () => {
    expect(soPhieuCong({ the: "da_huy", n: N, tong: 2 })).toBeNull();
    expect(soPhieuCong({ the: "cho", n: N, tong: 1 })).toBeNull();
    expect(soPhieuCong({ the: "tat_ca", n: null, tong: 0 })).toBeNull();
  });
});

describe("TaiKhoanO", () => {
  it("không có ngân hàng, số lẫn chi nhánh thì null (ô cột thuộc tính ẩn cả nhãn)", () => {
    expect(TaiKhoanO({ nganHang: null, so: null, chiNhanh: null })).toBeNull();
  });

  it("có dữ liệu: ngân hàng + số chung một mẩu, chi nhánh là thẻ nhỏ", () => {
    const { getByText } = render(<>{TaiKhoanO({ nganHang: "BIDV", so: "6501", chiNhanh: "CN Bình Dương" })}</>);
    expect(getByText("BIDV 6501")).toBeInTheDocument();
    expect(getByText("CN Bình Dương")).toHaveClass("kt-the");
  });
});
