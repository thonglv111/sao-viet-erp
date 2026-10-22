import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { SxWorkItemChiTiet } from "../api/client";
import { BatchForm, nhanTuyChon, type ThsxExec } from "./ThsxExecPanels";

const cv = {
  id: 1, department_id: 7, ten_cong_doan: "Cắt thành phẩm", loai_buoc: "to",
  don_vi_ra: "tờ", don_vi_vao: "tờ",
} as SxWorkItemChiTiet["cong_viec"];

function mo(khoan: SxWorkItemChiTiet["khoan"]) {
  render(<BatchForm
    cv={cv}
    khoan={khoan ?? null}
    busy={false}
    tranGhi={null}
    onXong={vi.fn()}
    exec={{ taoBatch: vi.fn() } as unknown as ThsxExec}
  />);
}

describe("Ghi mẻ lấy Khoán cố định từ Công đoạn", () => {
  it("không còn radio/tìm/đổi Công việc khoán", () => {
    mo({
      id: 9, ten: "Cắt thành phẩm", don_gia: 25, don_vi: "to", don_vi_ten: "tờ",
      phat_sinh: [{ id: 3, ten: "Thay kẽm", don_gia: 100000, don_vi: "kem", don_vi_ten: "bản kẽm" }],
    });
    // Tên công đoạn ở phụ đề hộp, tên việc khoán ở khối Khoán — trùng chữ vì cùng tên.
    expect(screen.getAllByText("Cắt thành phẩm")).toHaveLength(2);
    expect(screen.getByText("25 đ một tờ")).toBeInTheDocument();
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(screen.queryByText("Đổi việc")).toBeNull();
    expect(screen.getByText("Thay kẽm")).toBeInTheDocument();
  });

  it("chưa cấu hình vẫn mở form ghi mẻ bình thường, không câu báo chưa cấu hình", () => {
    mo(null);
    expect(screen.queryByText(/chưa cấu hình Khoán/)).toBeNull();
    expect(screen.getByLabelText("Số lượng làm được")).toBeInTheDocument();
  });

  it("nói số còn ghi được và có nút Tối đa", () => {
    render(<BatchForm
      cv={cv}
      khoan={null}
      busy={false}
      tranGhi={{
        cung_to: true,
        nguon_ten: "In",
        da_nhan: 1300,
        da_ghi: 1200,
        toi_da: 1300,
        toi_da_nhan: 1300,
        loi_kcs: 0,
        dau_chuoi: false,
        he_so: 1,
        con_ghi_duoc: 100,
        don_vi_nhan: "to",
      }}
      onXong={vi.fn()}
      exec={{ taoBatch: vi.fn() } as unknown as ThsxExec}
    />);

    expect(screen.getByText(/^còn ghi được/)).toHaveTextContent(/^còn ghi được 100/);
    expect(screen.getByRole("button", { name: "Tối đa 100" })).toBeInTheDocument();
  });
});

describe("Tuỳ chọn khi ghi (Đợt 2)", () => {
  it("tick Có / không, gõ số rồi Ghi ⇒ body có tuy_chon", async () => {
    const user = userEvent.setup();
    const taoBatch = vi.fn().mockResolvedValue([]);
    render(<BatchForm
      cv={cv}
      khoan={{
        id: 9, ten: "Bế", don_gia: 25, don_vi: "to", don_vi_ten: "tờ", phat_sinh: [],
        tuy_chon: [
          { ma: "trung_khuon", ten: "Trùng khuôn", kieu: "co_khong", goi_y: null },
          { ma: "so_lo", ten: "Số lỗ đục", kieu: "so", goi_y: "1 đến 4" },
        ],
      }}
      busy={false}
      tranGhi={null}
      nguoiGhi={[{ employee_id: 5, ho_ten: "An", nghi: null, dang_o: [], tick_san: true }]}
      onXong={vi.fn()}
      exec={{ taoBatch } as unknown as ThsxExec}
    />);
    expect(screen.getByPlaceholderText("1 đến 4")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Số lượng làm được"), "500");
    await user.click(screen.getByLabelText("Trùng khuôn"));
    await user.type(screen.getByLabelText("Số lỗ đục"), "3");
    await user.click(screen.getByRole("button", { name: "Ghi sản lượng" }));
    expect(taoBatch).toHaveBeenCalledTimes(1);
    expect(taoBatch.mock.calls[0][0].tuy_chon).toEqual({ trung_khuon: 1, so_lo: 3 });
  });

  it("công đoạn không khai tuỳ chọn ⇒ không có khối, body không có tuy_chon", async () => {
    const user = userEvent.setup();
    const taoBatch = vi.fn().mockResolvedValue([]);
    render(<BatchForm
      cv={cv}
      khoan={{ id: 9, ten: "Bế", don_gia: 25, don_vi: "to", don_vi_ten: "tờ", phat_sinh: [] }}
      busy={false}
      tranGhi={null}
      nguoiGhi={[{ employee_id: 5, ho_ten: "An", nghi: null, dang_o: [], tick_san: true }]}
      onXong={vi.fn()}
      exec={{ taoBatch } as unknown as ThsxExec}
    />);
    expect(screen.queryByText("Tuỳ chọn lần này")).toBeNull();
    await user.type(screen.getByLabelText("Số lượng làm được"), "500");
    await user.click(screen.getByRole("button", { name: "Ghi sản lượng" }));
    expect(taoBatch.mock.calls[0][0]).not.toHaveProperty("tuy_chon");
  });

  it("công đoạn chia bậc: tick Mực UV đổi bậc và giá ngay trong hộp", async () => {
    const user = userEvent.setup();
    const bacChon = (uv: number, ten: string, cd: number, dg: number) => ({
      chon: { muc_uv: uv }, bac_ma: uv ? "b3" : "b2", bac_ten: ten, so_mau: 2, so_mau_pha: 1,
      gia_co_dinh: cd, don_gia: dg, thieu_gia: false,
    });
    mo({
      id: 9, ten: "Bài in", don_gia: 30, gia_co_dinh: 225000, don_vi: "to", don_vi_ten: "tờ", phat_sinh: [],
      tuy_chon: [{ ma: "muc_uv", ten: "Mực UV", kieu: "co_khong", goi_y: null }],
      bac_theo_chon: [bacChon(0, "1–2 màu Pantone", 225000, 30), bacChon(1, "1–2 màu Pantone UV", 450000, 40)],
      so_mau: 2, so_mau_pha: 1,
    });
    expect(screen.getByText("1–2 màu Pantone")).toBeInTheDocument();
    expect(screen.getByText("lệnh 2 màu, 1 màu pha")).toBeInTheDocument();
    expect(screen.getByText("225.000 đ một lần ghi + 30 đ một tờ")).toBeInTheDocument();
    await user.click(screen.getByLabelText("Mực UV"));
    expect(screen.getByText("1–2 màu Pantone UV")).toBeInTheDocument();
    expect(screen.getByText("450.000 đ một lần ghi + 40 đ một tờ")).toBeInTheDocument();
  });

  it("thẻ ở lần ghi cùng chữ ngăn soi, bỏ mục bằng 0", () => {
    expect(nhanTuyChon([
      { ma: "trung_khuon", ten: "Trùng khuôn", kieu: "co_khong", gia_tri: 1 },
      { ma: "so_lo", ten: "Số lỗ đục", kieu: "so", gia_tri: 3 },
      { ma: "phu", ten: "Phủ", kieu: "co_khong", gia_tri: 0 },
    ])).toEqual(["trùng khuôn", "3 số lỗ đục"]);
  });
});
