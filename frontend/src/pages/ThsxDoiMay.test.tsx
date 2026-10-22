import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { api, type SxMayDoiOut } from "../api/client";
import { ThsxDoiMay } from "./ThsxDoiMay";

vi.mock("../auth/useAuth", () => ({ useAuth: () => ({ token: "token-test" }) }));

// Máy thuộc tổ (spec 2026-10-22-may-thuoc-to §4.9): hộp Đổi máy chỉ mời máy CỦA TỔ, mỗi máy kèm tổ
// khác máy cũng thuộc; tổ hết máy thì nói việc chờ máy sửa xong.
function bay(ds: SxMayDoiOut) {
  vi.spyOn(api.sanXuat, "mayDoi").mockResolvedValue(ds);
  render(<ThsxDoiMay congViecId={7} mayHienTaiId={1} mayHienTai="IN-01 Máy 2 màu" tenCongDoan="In offset"
    busy={false} onDoi={vi.fn(async () => true)} onClose={vi.fn()} />);
}

describe("ThsxDoiMay", () => {
  afterEach(() => vi.restoreAllMocks());

  it("máy thuộc thêm tổ khác thì hiện tên tổ đó dưới máy và ở thẻ khi đã chọn", async () => {
    bay({ theo_cong_doan: true, theo_to: true, items: [{
      id: 2, ma: "IN-02", ten: "Máy 4 màu", loai_may: "Máy in", trang_thai: "ranh", nhan: "Rảnh",
      chi_tiet: null, to_khac: ["Nhóm thợ in máy 5 màu"],
    }] });
    fireEvent.click(await screen.findByRole("button", { name: "Đổi sang máy" }));
    const dong = await screen.findByText("Cũng thuộc Nhóm thợ in máy 5 màu");
    fireEvent.mouseDown(dong);
    expect(document.querySelector(".lds-tag")?.textContent).toBe("Nhóm thợ in máy 5 màu");
    expect(screen.getByText("Chỉ hiện máy của tổ chạy được công đoạn In offset.")).toBeTruthy();
  });

  it("tổ không còn máy khác thì nói việc chờ máy sửa và khoá nút Đổi máy", async () => {
    bay({ theo_cong_doan: true, theo_to: true, items: [] });
    expect(await screen.findByText("Tổ không còn máy khác chạy công đoạn này. Việc chờ máy sửa xong."))
      .toBeTruthy();
    expect((screen.getByRole("button", { name: "Đổi máy" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
