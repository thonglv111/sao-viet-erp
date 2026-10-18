/** Màn Tiêu chí KCS: câu giải thích ở ô phải. */
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { KcsKhaiBaoCongDoan } from "../../../api/client";
import { AuthContext, type AuthState } from "../../../auth/AuthContext";

const goi = vi.hoisted(() => ({ khaiBao: vi.fn() }));
vi.mock("../../../api/client", async (g) => ({
  ...(await g<typeof import("../../../api/client")>()),
  api: { kcsHangMuc: goi },
}));

import { KcsTieuChiPage } from "./KcsTieuChiPage";

const AUTH: AuthState = {
  status: "authenticated", user: null, token: "t",
  login: async () => {}, logout: async () => {},
  updateUser: () => {}, notice: null, setNotice: () => {},
};

function cd(id: number, ma: string, ten: string, cau: string[]): KcsKhaiBaoCongDoan {
  return {
    cong_doan_id: id, ma, ten, nhom: "finishing",
    hang_muc: cau.map((t, i) => ({ id: id * 100 + i, ma: `KM${id}${i}`, cong_doan_id: id, ten: t, thu_tu: i + 1 })),
  };
}

beforeEach(() => {
  window.history.replaceState(null, "", "/");
});
afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("KcsTieuChiPage", () => {
  it("#6 câu 'KCS cuối xét nhóm này' giữ nguyên hoa/thường tên công đoạn (E2E Be thu không thành e2E)", async () => {
    goi.khaiBao.mockReset().mockResolvedValue({
      giai_doan: [{ nhom: "finishing", cong_doan: [cd(1, "E2E-BE", "E2E Be thu", ["Bế đúng hình"])] }],
    });
    render(
      <AuthContext.Provider value={AUTH}>
        <KcsTieuChiPage />
      </AuthContext.Provider>,
    );
    const cau = await screen.findByText(/KCS cuối xét nhóm này/);
    expect(cau.textContent).toContain("công đoạn E2E Be thu");
    expect(cau.textContent).not.toContain("e2E");
  });
});
