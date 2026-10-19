import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ChotGiayDong } from "../api/client";
import { ThsxChotGiay } from "./ThsxChotGiay";

vi.mock("../auth/useAuth", () => ({ useAuth: () => ({ token: "token-test" }) }));
const list = vi.fn();
const them = vi.fn();
const xoa = vi.fn();
const chot = vi.fn();
vi.mock("../api/client", async (goc) => ({
  ...(await goc<typeof import("../api/client")>()),
  api: {
    sanXuat: {
      chotGiay: {
        list: (...a: unknown[]) => list(...a),
        them: (...a: unknown[]) => them(...a),
        xoa: (...a: unknown[]) => xoa(...a),
        chot: (...a: unknown[]) => chot(...a),
        go: vi.fn(),
      },
    },
  },
}));

function dong(kw: Partial<ChotGiayDong>): ChotGiayDong {
  return {
    chu_the: "lsx", id: 3, ma: "LSX26-0003", ten: "Catalogue", han: null,
    giay: [{
      giay_id: 1, ma: "C250", ten: "Couche 250", kho_rong: 790, kho_dai: 1090, nhan_kho: "790×1090 mm",
      so_to: 5260, don_vi: "to_nguyen", ton_to_dung_kho: 3000,
    }],
    lo_cung_ma: [], chot: null, sua_duoc: true, buoc_truoc_in: [], cau_hinh_san: false,
    cong_doan_chen_duoc: [{ id: 7, ma: "CD-0112", ten: "Cắt tờ" }],
    ...kw,
  };
}

describe("ThsxChotGiay · tổ Cắt chỉ thấy công đoạn Trước In", () => {
  beforeEach(() => { list.mockReset(); them.mockReset(); xoa.mockReset(); chot.mockReset(); });

  it("chưa có công đoạn: hiện 'Chưa có công đoạn cắt' + Thêm công đoạn + Không cần cắt", async () => {
    list.mockResolvedValue([dong({})]);
    render(<ThsxChotGiay teamId={5} />);
    await screen.findByText("Chưa có công đoạn cắt");
    expect(screen.getByRole("button", { name: /Không cần cắt/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Thêm công đoạn/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Cắt tờ/ }));
    them.mockResolvedValue({});
    fireEvent.click(screen.getByRole("button", { name: /^Thêm$/ }));
    await waitFor(() => expect(them).toHaveBeenCalledWith("token-test", {
      team_id: 5, lsx_id: 3, cong_doan_ids: [7],
    }));
  });

  it("lệnh đặt sẵn bước cắt: liệt kê bước, Xoá gọi đúng bước; không có nút Không cần cắt", async () => {
    list.mockResolvedValue([dong({
      cau_hinh_san: true,
      buoc_truoc_in: [{ buoc_id: 41, cong_doan_id: 7, ma: "CD-0112", ten: "Cắt tờ", xoa_duoc: true }],
    })]);
    xoa.mockResolvedValue({});
    render(<ThsxChotGiay teamId={5} />);
    await screen.findByText("1. Cắt tờ");
    expect(screen.queryByRole("button", { name: /Không cần cắt/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Xoá công đoạn Cắt tờ/ }));
    await waitFor(() => expect(xoa).toHaveBeenCalledWith("token-test", {
      team_id: 5, lsx_id: 3, buoc_id: 41,
    }));
  });

  it("bước đã bắt đầu: ẩn nút Xoá, ghi lý do", async () => {
    list.mockResolvedValue([dong({
      chot: { cach: "cat", luc: null, boi_ten: null, cong_doan: ["Cắt tờ"] },
      buoc_truoc_in: [{ buoc_id: 41, cong_doan_id: 7, ma: "CD-0112", ten: "Cắt tờ", xoa_duoc: false }],
    })]);
    render(<ThsxChotGiay teamId={5} />);
    const khoa = await screen.findByText("Đã bắt đầu");
    expect(khoa.getAttribute("title")).toMatch(/Bước đã bắt đầu/);
    expect(screen.queryByRole("button", { name: /Xoá công đoạn/ })).toBeNull();
  });

  it("đã chốt không cắt: nhãn + Gỡ chốt, không có danh sách bước", async () => {
    list.mockResolvedValue([dong({ chot: { cach: "khong_cat", luc: null, boi_ten: "Tổ trưởng", cong_doan: [] } })]);
    render(<ThsxChotGiay teamId={5} />);
    await screen.findByText(/Đã chốt: không cắt/);
    expect(screen.getByRole("button", { name: "Gỡ chốt" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Thêm công đoạn/ })).toBeNull();
  });
});


describe("ThsxChotGiay · lỗi máy chủ và quyền (#26)", () => {
  beforeEach(() => { list.mockReset(); chot.mockReset(); });

  it("máy chủ từ chối thì câu báo còn nguyên sau lượt nạp lại", async () => {
    list.mockResolvedValue([dong({})]);
    const { ApiError } = await import("../api/client");
    chot.mockRejectedValue(new ApiError("Bạn không có quyền Thực hiện lệnh ở tổ này", 403));
    render(<ThsxChotGiay teamId={5} />);
    fireEvent.click(await screen.findByRole("button", { name: /Không cần cắt/ }));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByRole("alert").textContent).toContain("Bạn không có quyền Thực hiện lệnh ở tổ này");
  });

  it("không có quyền Thực hiện cả tổ thì không bày nút ghi", async () => {
    list.mockResolvedValue([dong({})]);
    render(<ThsxChotGiay teamId={5} ghiDuoc={false} />);
    await screen.findByText("Chưa có công đoạn cắt");
    expect(screen.queryByRole("button", { name: /Không cần cắt/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Thêm công đoạn/ })).toBeNull();
  });
});
