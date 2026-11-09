import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { XlDongBan, XlNganHen as NganData } from "../api/client";
import { XlNganHen } from "./XlNganHen";

function ngan(p: Partial<XlDongBan> = {}): NganData {
  return {
    dau: {
      lsx_id: 7, ma: "LSX-007", ten: "Hộp giấy", customer_name: "Khách A", trang_thai: "da_lap_ke_hoach",
      is_rush: false, so_luong_dat: 1000, don_vi_tinh: "cái", han_giao_khach: "2026-11-12", hen_luc: "2026-11-09T07:30:00",
      nguoi_hen: "Lan", da_day_luc: null, ket_ly_do: null, ket_luc: null, vat_tu: null, vat_tu_ve: null,
      cum_id: null, updated_at: null, ...p,
    },
    vat_tu: [],
    cong_doan: [{ buoc: 1, ten: "In offset", bo_phan: "Tổ in", so_luong: 1000, don_vi: "tờ" }],
  };
}

function ve(n: NganData) {
  return render(
    <XlNganHen ngan={n} goi={null} dangTai={false} loi={false} duyetDuoc dangGhi={false}
      lichSu={[{ luc: "2026-11-08T16:20:00", nguoi: "Lan", viec: "Đổi giờ hẹn", chi_tiet: "09/11/2026 07:30 sang 10/11/2026 07:30" }]}
      onBoHen={vi.fn()} onDoiGio={vi.fn()} onDayNgay={vi.fn()} onThuHoi={vi.fn()} onCapNhat={vi.fn()} onDong={vi.fn()} />,
  );
}

describe("ngăn hẹn đẩy", () => {
  it("tab Lịch sử hẹn có cột Lúc, Người, Việc", async () => {
    ve(ngan());
    await userEvent.click(screen.getByRole("tab", { name: "Lịch sử hẹn" }));
    for (const c of ["Lúc", "Người", "Việc"]) expect(screen.getByRole("columnheader", { name: c })).toBeInTheDocument();
    expect(screen.getByText("Đổi giờ hẹn")).toBeInTheDocument();
  });

  it("tab Công đoạn có cột Bộ phận nhận", async () => {
    ve(ngan());
    await userEvent.click(screen.getByRole("tab", { name: "Công đoạn" }));
    expect(screen.getByRole("columnheader", { name: "Bộ phận nhận" })).toBeInTheDocument();
    expect(screen.getByText("Tổ in")).toBeInTheDocument();
  });

  it("lệnh chưa đẩy có Bỏ hẹn, lệnh đã đẩy chỉ còn Thu hồi", () => {
    const { unmount } = ve(ngan());
    expect(screen.getByRole("button", { name: "Bỏ hẹn" })).toBeInTheDocument();
    unmount();
    ve(ngan({ trang_thai: "da_phat_hanh", da_day_luc: "2026-11-08T07:30:00" }));
    expect(screen.getByRole("button", { name: "Thu hồi" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Bỏ hẹn" })).toBeNull();
  });
});
