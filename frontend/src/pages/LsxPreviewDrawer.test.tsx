/** Ngăn "lệnh dự kiến" của Kế hoạch SX. */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LsxPreviewLine, LsxPreviewOut } from "../api/client";
import { AuthContext, type AuthState } from "../auth/AuthContext";

const goi = vi.hoisted(() => ({ preview: vi.fn(), tao: vi.fn() }));
vi.mock("../api/client", async (g) => ({
  ...(await g<typeof import("../api/client")>()),
  api: { lsx: goi },
}));

// Nhãn chặng dòng giấy đọc từ `/api/don-vi/tram` (nạp lúc chạy); test cho sẵn bảng nhỏ.
vi.mock("./tenDonVi", async (g) => ({
  ...(await g<typeof import("./tenDonVi")>()),
  nhanTram: (ma: string | null | undefined) => ({ to: "tờ in", to_nguyen: "tờ nguyên" } as Record<string, string>)[(ma ?? "").toLowerCase()],
}));

import { LsxPreviewDrawer } from "./LsxPreviewDrawer";

const AUTH: AuthState = {
  status: "authenticated", user: null, token: "t",
  login: async () => {}, logout: async () => {},
  updateUser: () => {}, notice: null, setNotice: () => {},
};

function dong(patch: Partial<LsxPreviewLine> = {}): LsxPreviewLine {
  return {
    order_line_id: 1, ten: "Hộp E2E", so_luong_dat: 700, don_vi_tinh: "cái",
    phieu_thanh_phan_id: 9, ptg_ma: "PTG-1", nhom: null,
    bu_hao_to: 100, so_to_ke_hoach: 1400, so_to_nguyen: 700, so_con: 2, so_kem: 4, so_luot: 1400,
    don_vi_to: "to", don_vi_to_nguyen: null, don_vi_tp: null, don_vi_tay: null,
    routing: [], quy_cach: null, sl_ptg: null, lsx_id: null, lsx_ma: null,
    ...patch,
  };
}

function dung(lines: LsxPreviewLine[]): LsxPreviewOut {
  return {
    order_id: 40, order_no: "DH011", customer_name: "Khách E2E", sale_name: null,
    delivery_committed_date: null, is_rush: false, production_note: null, lines,
  };
}

function ve(onCreated: (...a: unknown[]) => void = () => {}) {
  return render(
    <AuthContext.Provider value={AUTH}>
      <LsxPreviewDrawer orderId={40} canCreate onClose={() => {}} onCreated={onCreated} onOpenLsx={() => {}} />
    </AuthContext.Provider>,
  );
}

beforeEach(() => goi.preview.mockReset());

/** Ô của cột `ten` ở dòng đầu của bảng. */
function oCot(ten: string): HTMLElement {
  const cot = screen.getAllByRole("columnheader").findIndex((th) => th.textContent === ten);
  const hang = screen.getAllByRole("row")[1];
  return within(hang).getAllByRole("cell")[cot];
}

describe("LsxPreviewDrawer", () => {
  it("#14 server không gửi đơn vị tờ nguyên (routing không xả giấy) thì cột Giấy nguyên chỉ hiện số, không bịa nhãn 'tờ in'", async () => {
    goi.preview.mockResolvedValue(dung([dong({ don_vi_to_nguyen: null })]));
    ve();
    await screen.findByText("Hộp E2E");
    const o = oCot("Giấy nguyên");
    expect(o.textContent).toBe("700");
    // Cột Vào máy vẫn mang đơn vị tờ in của chính nó.
    expect(oCot("Vào máy").textContent).toContain("tờ in");
  });

  it("#14 có đơn vị tờ nguyên thì hiện đúng nhãn của nó", async () => {
    goi.preview.mockResolvedValue(dung([dong({ don_vi_to_nguyen: "to_nguyen" })]));
    ve();
    await screen.findByText("Hộp E2E");
    expect(oCot("Giấy nguyên").textContent).toBe("700tờ nguyên");
  });

  it("#14 dòng đầu ngăn nói 'Lệnh dự kiến, chưa lưu', không dùng chữ kỹ thuật 'DB' hay dấu ·", async () => {
    goi.preview.mockResolvedValue(dung([dong()]));
    ve();
    await screen.findByText("Hộp E2E");
    expect(screen.getByText("Lệnh dự kiến, chưa lưu")).toBeInTheDocument();
    expect(screen.queryByText(/chưa ghi DB/)).toBeNull();
  });

  it("#17 tạo lệnh xong báo cả MÃ đơn cho màn Kế hoạch SX để thẻ lọc không phải đoán nhãn", async () => {
    goi.preview.mockResolvedValue(dung([dong()]));
    goi.tao.mockResolvedValue({ items: [{ ma: "LSX26-0001" }] });
    const xong = vi.fn();
    ve(xong);
    await screen.findByText("Hộp E2E");
    await userEvent.click(screen.getByRole("button", { name: /Xác nhận tạo 1 lệnh sản xuất/ }));
    await waitFor(() => expect(xong).toHaveBeenCalledWith(40, ["LSX26-0001"], "DH011"));
  });
});
