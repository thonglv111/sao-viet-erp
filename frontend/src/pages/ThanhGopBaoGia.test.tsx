import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { ThanhGopBaoGia } from "./ThanhGopBaoGia";

function Khung({ dau = "", apDung = () => {} }: { dau?: string; apDung?: () => void }) {
  const [ten, setTen] = useState(dau);
  return <ThanhGopBaoGia soChon={2} tenNhom={ten} onTenNhom={setTen} nhomDaCo={[]} onApDung={apDung} onBo={() => {}} />;
}

describe("ThanhGopBaoGia", () => {
  it("#9 nút 'Gộp khi báo giá' khoá lúc chưa gõ tên thì nói vì sao; gõ tên rồi thì hết lời nhắc và bấm được", async () => {
    const apDung = vi.fn();
    render(<Khung apDung={apDung} />);
    const nut = screen.getByRole("button", { name: "Gộp khi báo giá" });
    expect(nut).toBeDisabled();
    expect(nut).toHaveAttribute("title", "Gõ tên in ra báo giá trước khi gộp");

    await userEvent.type(screen.getByLabelText("Tên nhóm in ra báo giá"), "Sách A5");
    expect(nut).toBeEnabled();
    expect(nut).not.toHaveAttribute("title");
    await userEvent.click(nut);
    expect(apDung).toHaveBeenCalledOnce();
  });
});
