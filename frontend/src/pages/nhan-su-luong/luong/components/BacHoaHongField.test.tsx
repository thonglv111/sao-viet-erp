import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { BacHoaHongField, type BacHoaHong } from "./BacHoaHongField";

// Biểu hoa hồng theo số ngày thu tiền (23/10/2026) — y khuôn ô bù hao: chỉ khai MỐC TRÊN, bậc cuối vô
// hạn. `pct` ở đây là % hiển thị (3 = 3%), modal tự đổi sang phân số lúc lưu.
const CTV: BacHoaHong[] = [
  { den_ngay: 45, pct: 3 },
  { den_ngay: 60, pct: 2 },
  { den_ngay: 75, pct: 1 },
  { den_ngay: null, pct: 0 },
];

describe("BacHoaHongField", () => {
  it("hai cột đọc thành câu", () => {
    render(<BacHoaHongField value={CTV} onChange={() => {}} />);
    expect(screen.getByRole("columnheader", { name: "Khi số ngày thu tiền" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Thì hoa hồng" })).toBeInTheDocument();
  });

  it("nhãn khoảng nối từ mốc của bậc liền trước", () => {
    render(<BacHoaHongField value={CTV} onChange={() => {}} />);
    expect(screen.getByText("Đến")).toBeInTheDocument();
    expect(screen.getByText("Trên 45 đến")).toBeInTheDocument();
    expect(screen.getByText("Trên 75 ngày")).toBeInTheDocument();
  });

  it("bậc vô hạn duy nhất là 'Mọi số ngày'", () => {
    render(<BacHoaHongField value={[{ den_ngay: null, pct: 0.5 }]} onChange={() => {}} />);
    expect(screen.getByText("Mọi số ngày")).toBeInTheDocument();
  });

  it("bậc vô hạn không có ô mốc và không xoá được", () => {
    render(<BacHoaHongField value={CTV} onChange={() => {}} />);
    expect(screen.getAllByTitle("Mốc trên của bậc (ngày)")).toHaveLength(3);
    expect(screen.getAllByTitle("Xóa bậc")).toHaveLength(3);
  });

  it("'＋ Thêm bậc' chèn TRƯỚC bậc vô hạn", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<BacHoaHongField value={CTV} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "＋ Thêm bậc" }));
    const moi = onChange.mock.calls[0][0] as BacHoaHong[];
    expect(moi).toHaveLength(5);
    expect(moi[3].den_ngay).toBe(90);            // gợi ý = cận dưới + 15 ngày
    expect(moi[4].den_ngay).toBeNull();
  });

  it("rỗng thì nói rõ là không hưởng, bấm thêm ra bậc vô hạn", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<BacHoaHongField value={[]} onChange={onChange} />);
    expect(screen.getByText("Không hưởng hoa hồng — bấm “＋ Thêm bậc”.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "＋ Thêm bậc" }));
    expect(onChange.mock.calls[0][0]).toEqual([{ den_ngay: null, pct: 0 }]);
  });

  it("bậc vô hạn là bậc DUY NHẤT thì xoá được — về không hưởng", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<BacHoaHongField value={[{ den_ngay: null, pct: 2 }]} onChange={onChange} />);
    await user.click(screen.getByTitle("Xóa bậc"));
    expect(onChange.mock.calls[0][0]).toEqual([]);
  });

  it("mốc không tăng dần thì đánh dấu hàng sai", () => {
    const { container } = render(
      <BacHoaHongField
        value={[{ den_ngay: 60, pct: 2 }, { den_ngay: 45, pct: 3 }, { den_ngay: null, pct: 0 }]}
        onChange={() => {}}
      />,
    );
    expect(container.querySelectorAll(".rc-bands__row--invalid")).toHaveLength(1);
  });
});
