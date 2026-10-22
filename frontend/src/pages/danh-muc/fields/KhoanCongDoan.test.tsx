import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { doiMaTrongCongThuc, doiTuyChonTrongBac, KhoanCongDoanField, maBacMoi, tuyChonThanhBien } from "./KhoanCongDoan";
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
  it("thêm tuỳ chọn: mã tự sinh từ tên, không có ô Mã; trùng mã thì thêm hậu tố", async () => {
    const user = userEvent.setup();
    let cuoi: KhoanCongDoanValue = {};
    bay({ unit: "to", unit_price: 120 }, (v) => (cuoi = v));
    expect(screen.queryByLabelText(/Mã tuỳ chọn/)).toBeNull();
    await user.click(screen.getByRole("button", { name: "＋ Thêm tuỳ chọn" }));
    await user.type(screen.getByLabelText("Tên tuỳ chọn 1"), "Trùng khuôn");
    expect(cuoi.tuy_chon?.[0]).toEqual({ ma: "trung_khuon", ten: "Trùng khuôn", kieu: "co_khong", goi_y: null });

    await user.click(screen.getByRole("button", { name: "＋ Thêm tuỳ chọn" }));
    await user.type(screen.getByLabelText("Tên tuỳ chọn 2"), "Trùng khuôn");
    expect(cuoi.tuy_chon?.[1].ma).toBe("trung_khuon_2");
    await user.clear(screen.getByLabelText("Tên tuỳ chọn 2"));
    await user.type(screen.getByLabelText("Tên tuỳ chọn 2"), "Max");
    expect(cuoi.tuy_chon?.[1].ma).toBe("max_2");
    await user.selectOptions(screen.getByLabelText("Kiểu tuỳ chọn 2"), "so");
    expect(cuoi.tuy_chon?.[1]).toEqual({ ma: "max_2", ten: "Max", kieu: "so", goi_y: null });

    await user.click(screen.getAllByTitle("Bỏ tuỳ chọn này")[0]);
    expect(cuoi.tuy_chon?.map((t) => t.ma)).toEqual(["max_2"]);
  });

  it("tuỳ chọn đã lưu giữ mã khi đổi tên; tuỳ chọn mới đổi tên thì công thức đổi mã theo", async () => {
    const user = userEvent.setup();
    let cuoi: KhoanCongDoanValue = {};
    bay({
      unit: "to", unit_price: 30, cong_thuc_khoan: "(1 - chay_tiep) * gia_co_dinh",
      tuy_chon: [{ ma: "chay_tiep", ten: "Chạy tiếp", kieu: "co_khong", goi_y: null }],
    }, (v) => (cuoi = v));
    await user.type(screen.getByLabelText("Tên tuỳ chọn 1"), " bài ghép");
    expect(cuoi.tuy_chon?.[0]).toMatchObject({ ma: "chay_tiep", ten: "Chạy tiếp bài ghép" });

    await user.click(screen.getByRole("button", { name: "＋ Thêm tuỳ chọn" }));
    await user.type(screen.getByLabelText("Tên tuỳ chọn 2"), "Lỗ");
    expect(cuoi.tuy_chon?.[1].ma).toBe("lo");
    expect(doiMaTrongCongThuc("lo * 2 + so_lo", cuoi.tuy_chon!, [cuoi.tuy_chon![0], { ...cuoi.tuy_chon![1], ma: "lo_duc" }]))
      .toBe("lo_duc * 2 + so_lo");
    expect(cuoi.cong_thuc_khoan).toBe("(1 - chay_tiep) * gia_co_dinh");
  });

  it("gõ Giá cố định chung", async () => {
    const user = userEvent.setup();
    let cuoi: KhoanCongDoanValue = {};
    bay({ unit: "to", unit_price: 120 }, (v) => (cuoi = v));
    await user.type(screen.getByLabelText("Giá cố định chung"), "150000");
    expect(cuoi.gia_co_dinh).toBe(150000);
  });

  it("tổ có giá mà không còn phụ trách: gọi đúng tên, không bày giá chung mờ, xoá được", async () => {
    const user = userEvent.setup();
    let cuoi: KhoanCongDoanValue = {};
    const dau: KhoanCongDoanValue = {
      unit: "to", unit_price: 40, gia_co_dinh: 450000,
      viec_phat_sinh: [{ ten: "Xuống bài", don_gia: 0, don_vi: "bai",
        gia_theo_to: [{ department_id: 11, don_gia: 187500 }, { department_id: 12, don_gia: 150000 }] }],
    };
    function Vo() {
      const [v, setV] = useState<KhoanCongDoanValue>(dau);
      return (
        <KhoanCongDoanField value={v} donViOptions={[]}
          toPhuTrach={[{ id: 11, ten: "Máy 2 màu" }]}
          tatCaTo={[{ id: 11, ten: "Máy 2 màu" }, { id: 12, ten: "Máy 4 màu" }]}
          onChange={(x) => { setV(x); cuoi = x; }} />
      );
    }
    render(<AuthContext.Provider value={AUTH}><Vo /></AuthContext.Provider>);
    expect(screen.getByText("Máy 4 màu — không còn phụ trách")).toBeInTheDocument();
    expect(screen.getByLabelText("Đơn giá Máy 2 màu")).toHaveAttribute("placeholder", "40");
    expect(screen.getByLabelText("Đơn giá Máy 4 màu")).toHaveAttribute("placeholder", "");
    await user.click(screen.getByTitle("Bỏ giá của tổ này"));
    expect(cuoi.viec_phat_sinh?.[0].gia_theo_to).toEqual([{ department_id: 11, don_gia: 187500 }]);
  });

  it("chip tiền + sản lượng mà không nhân Đơn giá khoán thì nhắc ngay dưới ô công thức", () => {
    const { unmount } = bay({ cong_thuc_khoan: "gia_co_dinh + sl_ghi" }, () => {});
    expect(screen.getByText(/sản lượng đang cộng như tiền đồng/)).toBeInTheDocument();
    unmount();
    bay({ cong_thuc_khoan: "gia_co_dinh + sl_ghi * don_gia_khoan" }, () => {});
    expect(screen.queryByText(/sản lượng đang cộng như tiền đồng/)).toBeNull();
  });

  it("thêm bậc đầu tiên: giá theo tổ đang có thành giá của bậc, ô giá chung ẩn; bỏ bậc cuối thì giá quay về", async () => {
    const user = userEvent.setup();
    let cuoi: KhoanCongDoanValue = {};
    function Vo() {
      const [v, setV] = useState<KhoanCongDoanValue>({
        unit: "to", unit_price: null, gia_theo_to: [{ department_id: 11, gia_co_dinh: 150000, don_gia: 30 }],
      });
      return (
        <KhoanCongDoanField value={v} donViOptions={[]} toPhuTrach={[{ id: 11, ten: "Máy 2 màu" }]}
          onChange={(x) => { setV(x); cuoi = x; }} />
      );
    }
    render(<AuthContext.Provider value={AUTH}><Vo /></AuthContext.Provider>);
    await user.click(screen.getByRole("button", { name: "＋ Thêm bậc" }));
    expect(cuoi.bac_gia?.map((b) => b.ma)).toEqual(["b1"]);
    expect(cuoi.gia_theo_to).toEqual([{ department_id: 11, gia_co_dinh: 150000, don_gia: 30, bac: "b1" }]);
    expect(cuoi.unit_price).toBe(0);
    expect(screen.queryByLabelText("Đơn giá khoán")).toBeNull();
    await user.type(screen.getByLabelText("Tên bậc 1"), "1–2 màu thường");
    expect(screen.getByLabelText("Đơn giá Máy 2 màu bậc 1–2 màu thường")).toHaveValue(30);
    await user.click(screen.getByRole("button", { name: "＋ Thêm bậc" }));
    await user.type(screen.getByLabelText("Đơn giá Máy 2 màu bậc Bậc 2"), "40");
    expect(cuoi.gia_theo_to).toContainEqual({ department_id: 11, bac: "b2", don_gia: 40 });
    await user.click(screen.getAllByTitle("Bỏ bậc này")[1]);
    await user.click(screen.getByTitle("Bỏ bậc này"));
    expect(cuoi.bac_gia).toBeNull();
    expect(cuoi.gia_theo_to).toEqual([{ department_id: 11, gia_co_dinh: 150000, don_gia: 30 }]);
  });

  it("mã bậc không trùng; tuỳ chọn đổi mã hay bị xoá thì bậc đổi theo", () => {
    expect(maBacMoi([{ ma: "b2", ten: "x" }])).toBe("b3");
    const uv = { ma: "muc_uv", ten: "Mực UV", kieu: "co_khong" as const, goi_y: null };
    const bac = [{ ma: "b1", ten: "UV", tuy_chon_ma: "muc_uv", tuy_chon_co: "co" as const }];
    expect(doiTuyChonTrongBac(bac, [uv], [{ ...uv, ma: "uv" }])?.[0].tuy_chon_ma).toBe("uv");
    expect(doiTuyChonTrongBac(bac, [uv], [])?.[0]).toMatchObject({ tuy_chon_ma: null, tuy_chon_co: null });
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
