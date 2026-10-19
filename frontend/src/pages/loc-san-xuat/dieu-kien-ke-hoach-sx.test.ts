import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthContext, type AuthState } from "../../auth/AuthContext";
import { tomTat } from "../thanh-loc/thanh-loc";

const goi = vi.hoisted(() => ({ khachLoc: vi.fn(), donLoc: vi.fn() }));
vi.mock("../../api/client", async (g) => ({
  ...(await g<typeof import("../../api/client")>()),
  api: { lsx: goi },
}));

import {
  LOC_KHSX_TRONG, locKhsxLenUrl, locKhsxSauKhiTao, locKhsxTuUrl, thamSoLocLenhKhsx,
  useDieuKienLenhKhsx, type LocKhsx, type LocLenhKhsx,
} from "./dieu-kien-ke-hoach-sx";

const AUTH: AuthState = {
  status: "authenticated", user: null, token: "t",
  login: async () => {}, logout: async () => {},
  updateUser: () => {}, notice: null, setNotice: () => {},
};

const sach = (g: Record<string, string | undefined>) =>
  Object.fromEntries(Object.entries(g).filter(([, v]) => v != null)) as Record<string, string>;

describe("thanh lọc Kế hoạch SX — hai bảng chung một URL", () => {
  it("mặc định không ghi khoá nào", () => {
    expect(sach(locKhsxLenUrl(LOC_KHSX_TRONG))).toEqual({});
  });

  it("khoá hàng chờ mang tiền tố c_, đọc lại ra đúng trạng thái, không lẫn với bảng lệnh", () => {
    const t: LocKhsx = {
      lenh: { ky: { loai: "thang", moc: "han_sx" }, loc: { khach: 3, don: 7, gia_cong: "tron_goi" } },
      cho: { ky: { loai: "tuy", tu: "2026-10-01", den: "2026-10-31", moc: "chuyen" }, loc: { khach: 5 } },
    };
    const g = sach(locKhsxLenUrl(t));
    expect(g).toEqual({
      ky: "thang", moc: "han_sx", khach: "3", don: "7", gc: "tron_goi",
      c_ky: "tuy", c_tu: "2026-10-01", c_den: "2026-10-31", c_moc: "chuyen", c_khach: "5",
    });
    expect(locKhsxTuUrl(new URLSearchParams(g))).toEqual(t);
  });

  it("giá trị rác trên URL bị bỏ; tham số máy chủ đúng tên", () => {
    const t = locKhsxTuUrl(new URLSearchParams({ gc: "la", c_moc: "han_sx", khach: "x" }));
    expect(t.lenh.loc).toEqual({ khach: undefined, don: undefined, gia_cong: undefined });
    expect(t.cho.ky.moc).toBe("tao");
    expect(thamSoLocLenhKhsx({ khach: 1, don: 2, gia_cong: "cho_mang_di" }))
      .toEqual({ customer_id: 1, order_id: 2, gia_cong: "cho_mang_di" });
  });
});

// #17 (E2E 18/10/2026): lọc theo đơn xong xoá lệnh cuối cùng của đơn, chip lọc hiện "Đơn hàng là 40"
// (id nội bộ) thay vì "DH012" — danh sách đơn của ô lọc chỉ có đơn CÒN lệnh.
describe("lọc theo đơn của bảng lệnh Kế hoạch SX", () => {
  beforeEach(() => {
    goi.khachLoc.mockReset().mockResolvedValue([]);
    goi.donLoc.mockReset().mockResolvedValue([{ id: 7, ten: "DH003", so: 2 }]);
  });
  const bao = ({ children }: { children: ReactNode }) =>
    createElement(AuthContext.Provider, { value: AUTH }, children);

  it("chip lọc theo đơn ghi mã đơn kể cả khi đơn hết lệnh", async () => {
    const loc: LocLenhKhsx = { don: 40, nhan: "DH012" };
    const { result } = renderHook(() => useDieuKienLenhKhsx(0, loc), { wrapper: bao });
    await waitFor(() => expect(goi.donLoc).toHaveBeenCalled());
    const dkDon = result.current.find((d) => d.khoa === "don")!;
    await waitFor(() => expect(tomTat(dkDon, loc)).toBe("DH012"));
    // Đơn còn lệnh vẫn lấy nhãn từ danh sách máy chủ, không bị nhãn nhớ đè.
    await waitFor(() => expect(tomTat(result.current.find((d) => d.khoa === "don")!, { don: 7 })).toBe("DH003"));
  });

  it("sau khi tạo lệnh, bộ lọc giữ { don, nhan } và kỳ về Tất cả", () => {
    const sau = locKhsxSauKhiTao(
      { ...LOC_KHSX_TRONG, lenh: { ky: { loai: "thang", moc: "han_sx" }, loc: { khach: 3 } } },
      40, "DH012",
    );
    expect(sau.lenh.ky).toEqual({ loai: "tat_ca", moc: "han_sx" });
    expect(sau.lenh.loc).toEqual({ don: 40, nhan: "DH012" });
  });

  it("nhãn đơn đi theo URL để tải lại trang vẫn đọc ra mã đơn; bỏ đơn thì bỏ cả nhãn", () => {
    const t: LocKhsx = { ...LOC_KHSX_TRONG, lenh: { ky: { loai: "tat_ca", moc: "tao" }, loc: { don: 40, nhan: "DH012" } } };
    const g = sach(locKhsxLenUrl(t));
    expect(g).toMatchObject({ don: "40", dn: "DH012" });
    expect(locKhsxTuUrl(new URLSearchParams(g)).lenh.loc.nhan).toBe("DH012");
    expect(sach(locKhsxLenUrl({ ...t, lenh: { ...t.lenh, loc: { khach: 3 } } }))).not.toHaveProperty("dn");
  });
});
