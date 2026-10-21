import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { KhoanCongDoanField, tuyChonThanhBien } from "./KhoanCongDoan";
import type { KhoanCongDoanValue } from "../types";
import { AuthContext, type AuthState } from "../../../auth/AuthContext";

// `token: null` ⇒ `useBienCongThuc` trong `FormulaField` không gọi API (xem MayCuaCongDoan.test).
const AUTH: AuthState = {
  status: "anonymous", user: null, token: null,
  login: async () => {}, logout: async () => {},
  updateUser: () => {}, notice: null, setNotice: () => {},
};

function bay(dau: KhoanCongDoanValue, nhan: (v: KhoanCongDoanValue) => void) {
  function Vo() {
    const [v, setV] = useState<KhoanCongDoanValue>(dau);
    return (
      <KhoanCongDoanField value={v} donViOptions={[]} onChange={(x) => { setV(x); nhan(x); }} />
    );
  }
  return render(<AuthContext.Provider value={AUTH}><Vo /></AuthContext.Provider>);
}

describe("KhoanCongDoanField — Đợt 2", () => {
  it("thêm tuỳ chọn: mã tự gợi từ tên, sửa mã tay thì tên đổi không đè mã", async () => {
    const user = userEvent.setup();
    let cuoi: KhoanCongDoanValue = {};
    bay({ unit: "to", unit_price: 120 }, (v) => (cuoi = v));
    await user.click(screen.getByRole("button", { name: "＋ Thêm tuỳ chọn" }));
    await user.type(screen.getByLabelText("Tên tuỳ chọn 1"), "Trùng khuôn");
    expect(cuoi.tuy_chon?.[0]).toEqual({ ma: "trung_khuon", ten: "Trùng khuôn", kieu: "co_khong", goi_y: null });

    await user.click(screen.getByRole("button", { name: "＋ Thêm tuỳ chọn" }));
    await user.type(screen.getByLabelText("Tên tuỳ chọn 2"), "Số lỗ");
    expect(cuoi.tuy_chon?.[1].ma).toBe("so_lo");
    await user.clear(screen.getByLabelText("Mã tuỳ chọn 2"));
    await user.type(screen.getByLabelText("Mã tuỳ chọn 2"), "lo");
    await user.type(screen.getByLabelText("Tên tuỳ chọn 2"), " đục");
    await user.selectOptions(screen.getByLabelText("Kiểu tuỳ chọn 2"), "so");
    expect(cuoi.tuy_chon?.[1]).toEqual({ ma: "lo", ten: "Số lỗ đục", kieu: "so", goi_y: null });

    await user.click(screen.getAllByTitle("Bỏ tuỳ chọn này")[0]);
    expect(cuoi.tuy_chon?.map((t) => t.ma)).toEqual(["lo"]);
  });

  it("gõ Giá cố định chung", async () => {
    const user = userEvent.setup();
    let cuoi: KhoanCongDoanValue = {};
    bay({ unit: "to", unit_price: 120 }, (v) => (cuoi = v));
    await user.type(screen.getByLabelText("Giá cố định chung"), "150000");
    expect(cuoi.gia_co_dinh).toBe(150000);
  });

  it("chip tiền + sản lượng mà không nhân Đơn giá khoán thì nhắc ngay dưới ô công thức", () => {
    const { unmount } = bay({ cong_thuc_khoan: "gia_co_dinh + sl_ghi" }, () => {});
    expect(screen.getByText(/sản lượng đang cộng như tiền đồng/)).toBeInTheDocument();
    unmount();
    bay({ cong_thuc_khoan: "gia_co_dinh + sl_ghi * don_gia_khoan" }, () => {});
    expect(screen.queryByText(/sản lượng đang cộng như tiền đồng/)).toBeNull();
  });

  it("tuỳ chọn thành chip của ô Công thức khoán", () => {
    const b = tuyChonThanhBien([
      { ma: "trung_khuon", ten: "Trùng khuôn", kieu: "co_khong", goi_y: null },
      { ma: "so_lo", ten: "Số lỗ đục", kieu: "so", goi_y: null },
      { ma: "", ten: "", kieu: "co_khong", goi_y: null },
    ]);
    expect(b.map((x) => [x.ma, x.nhan, x.don_vi, x.loai])).toEqual([
      ["trung_khuon", "Trùng khuôn", "0/1", ["khoan"]],
      ["so_lo", "Số lỗ đục", "", ["khoan"]],
    ]);
  });
});
