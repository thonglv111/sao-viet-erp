import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LoiChuoiDonVi } from "./LoiChuoiDonVi";

describe("LoiChuoiDonVi (#8)", () => {
  it("chuỗi đứt đơn vị hiện lỗi đích danh bước, bỏ tiền tố tên thành phần", () => {
    render(
      <LoiChuoiDonVi
        loi={["Thành phần 'Hộp': Bước 'E2E Be thu' ra con nhưng bước 'Cắt thành phẩm' nhận tờ in — chuỗi đứt đơn vị."]}
      />,
    );
    const box = screen.getByRole("alert");
    expect(box.textContent).toContain("chưa ra giá được");
    expect(box.textContent).toContain("Bước 'E2E Be thu' ra con nhưng bước 'Cắt thành phẩm' nhận tờ in");
    expect(box.textContent).not.toContain("Thành phần 'Hộp'");
  });

  it("không lỗi thì không vẽ gì", () => {
    const { container } = render(<LoiChuoiDonVi loi={[]} />);
    expect(container.innerHTML).toBe("");
  });
});
