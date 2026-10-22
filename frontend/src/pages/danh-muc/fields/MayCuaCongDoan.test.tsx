import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { MayCuaCongDoanField } from "./MayCuaCongDoan";
import type { MayCongDoanRow } from "../types";
import { AuthContext, type AuthState } from "../../../auth/AuthContext";

// `token: null` ⇒ `useBienCongThuc` bên trong `FormulaField` KHÔNG gọi API (từ điển rỗng, chip
// hiện mã thay nhãn). Đúng mẫu `frontend/src/pages/FormulaField.test.tsx:20-26`.
const AUTH: AuthState = {
  status: "anonymous", user: null, token: null,
  login: async () => {}, logout: async () => {},
  updateUser: () => {}, notice: null, setNotice: () => {},
};

const MAY = [
  { id: 1, ma: "MAY-01", ten: "Komori 5 màu", loai_may: "Máy in" },
  { id: 2, ma: "MAY-02", ten: "Yawa 1050", loai_may: "Bế" },
];

function bay(props: Parameters<typeof MayCuaCongDoanField>[0]) {
  return render(
    <AuthContext.Provider value={AUTH}><MayCuaCongDoanField {...props} /></AuthContext.Provider>,
  );
}

describe("MayCuaCongDoanField", () => {
  // Máy thuộc tổ (spec 2026-10-22-may-thuoc-to §4.4): bảng dựng theo tổ đang tick, không chọn tay.
  const MAY_TO = [
    { id: 11, ma: "IN-01", ten: "Máy 2 màu", loai_may: "Máy in", to_ids: [1] },
    { id: 12, ma: "IN-02", ten: "Máy 4 màu", loai_may: "Máy in", to_ids: [2] },
    { id: 13, ma: "IN-03", ten: "Máy chung", loai_may: "Máy in", to_ids: [1, 2] },
  ];
  const TEN_TO = { 1: "Tổ A", 2: "Tổ B" };

  it("tick tổ A chỉ hiện máy của tổ A", () => {
    bay({ value: [], options: MAY_TO, toDangTick: [1], tenTo: TEN_TO, nhomCongDoan: "print",
          onChange: () => {} });
    expect(screen.getByRole("button", { name: /IN-01/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /IN-02/ })).toBeNull();
  });

  it("tick thêm tổ B thì máy tổ B hiện kèm công thức đã khai lúc trước", () => {
    bay({ value: [{ may_id: 11 }], options: MAY_TO, toDangTick: [1, 2], tenTo: TEN_TO,
          mayKhai: [{ may_id: 12, cong_thuc_gio: "sl_vao * 2" }], nhomCongDoan: "print",
          onChange: () => {} });
    const o = screen.getAllByTitle("Sửa cách đo giờ chạy của máy này").map((b) => b.textContent);
    expect(o).toEqual(["—", "sl_vao * 2", "—"]);
  });

  it("máy thuộc hai tổ đang tick là MỘT dòng, hai chip tổ", () => {
    bay({ value: [], options: MAY_TO, toDangTick: [1, 2], tenTo: TEN_TO, nhomCongDoan: "print",
          onChange: () => {} });
    expect(screen.getAllByRole("button", { name: /IN-03/ })).toHaveLength(1);
    const dong = screen.getByRole("button", { name: /IN-03/ }).closest("tr") as HTMLElement;
    expect(dong.textContent).toContain("Tổ A");
    expect(dong.textContent).toContain("Tổ B");
  });

  it("không còn ô chọn máy tay lẫn nút xoá dòng", () => {
    bay({ value: [], options: MAY_TO, toDangTick: [1], tenTo: TEN_TO, nhomCongDoan: "print",
          onChange: () => {} });
    expect(screen.queryByRole("button", { name: "Chọn máy cho công đoạn" })).toBeNull();
    expect(document.querySelector(".rc-bands__del")).toBeNull();
    expect(screen.getByText(/Máy hiện theo tổ đã tick/)).toBeInTheDocument();
  });

  it("sửa công thức thì gửi lên mọi dòng đang hiện", async () => {
    const user = userEvent.setup();
    let gui: MayCongDoanRow[] = [];
    function Bang() {
      const [v, setV] = useState<MayCongDoanRow[]>([]);
      return <MayCuaCongDoanField value={v} options={MAY_TO} toDangTick={[2]} tenTo={TEN_TO}
        nhomCongDoan="print" onChange={(x) => { gui = x; setV(x); }} />;
    }
    render(<AuthContext.Provider value={AUTH}><Bang /></AuthContext.Provider>);
    await user.click(screen.getAllByTitle("Sửa cách đo giờ chạy của máy này")[0]);
    await user.click(screen.getByRole("button", { name: "×" }));
    expect(gui.map((r) => r.may_id)).toEqual([12, 13]);
  });

  it("bấm tên máy mở Ô GIỜ, không kéo theo ô giá", async () => {
    const user = userEvent.setup();
    bay({ value: [{ may_id: 1 }], options: MAY, nhomCongDoan: "print",
          onChange: () => {} });
    await user.click(screen.getByRole("button", { name: /Komori 5 màu/ }));
    // `nhanO` render ra `<span className="rc-formula__editor-label">`, KHÔNG phải `<label for>`
    // ⇒ dùng `getByText`, `getByLabelText` sẽ không thấy.
    expect(screen.getByText(/^Công thức giờ chạy — /)).toBeInTheDocument();
    expect(screen.queryByText("Công thức giá")).not.toBeInTheDocument();
  });

  it("bấm ô giá của DÒNG NÀO thì mở đúng ô giá của dòng ấy", async () => {
    // Bẫy đã gặp trên màn thật: panel khoá theo DÒNG nên bấm ô "Cách tính giá" của dòng 2
    // không có gì xảy ra, panel của dòng 1 vẫn nằm đó — trông hệt như hệ bay ra công thức nhầm dòng.
    const user = userEvent.setup();
    bay({
      value: [{ may_id: 1, cong_thuc_gia: "sl_vao * 420" }, { may_id: 2, cong_thuc_gia: null }],
      options: MAY, nhomCongDoan: "print", onChange: () => {},
    });

    await user.click(screen.getAllByTitle("Sửa cách tính giá của máy này")[1]);

    // Soi trên `document`, KHÔNG phải `container`: panel nay là popup nổi treo ở `document.body`
    // qua portal (07/09/2026 — `FormulaPopover`), không còn là hàng phụ trong chính bảng.
    expect(document.querySelector("#ct-gia-2")).not.toBeNull();
    expect(document.querySelector("#ct-gia-1")).toBeNull();
    expect(document.querySelector("#ct-gio-2")).toBeNull();
  });

  it("panel là POPUP nổi ngoài bảng, bấm nền mờ thì đóng", async () => {
    // Lối cũ chèn hàng phụ vào chính bảng nên bấm ô ở cuối bảng là panel mọc ngoài tầm nhìn —
    // người khai bấm xong không thấy gì đổi. Hai điều kiện của bản popup: nằm NGOÀI cây của bảng,
    // và tự đóng khi bấm chỗ khác.
    const user = userEvent.setup();
    const { container } = bay({
      value: [{ may_id: 1, cong_thuc_gia: "sl_vao * 420" }],
      options: MAY, nhomCongDoan: "print", onChange: () => {},
    });

    await user.click(screen.getByTitle("Sửa cách tính giá của máy này"));
    const pop = screen.getByRole("dialog", { name: "Công thức giá" });
    expect(container.contains(pop)).toBe(false);

    // Bấm TRONG hộp không đóng; bấm nền mờ (29/09/2026: hộp giữa màn, nền quanh mờ) thì đóng.
    await user.click(pop);
    expect(screen.getByRole("dialog", { name: "Công thức giá" })).toBeInTheDocument();
    await user.click(document.querySelector(".rc-ct-pop__nen") as HTMLElement);
    expect(screen.queryByRole("dialog", { name: "Công thức giá" })).toBeNull();
  });

  it("Huỷ trả ô về công thức lúc mở, Xong thì giữ nguyên bản vừa sửa", async () => {
    // Ô công thức ghi thẳng vào form theo từng nhịp gõ, nên popup phải tự nhớ bản gốc — không thì
    // lỡ tay sửa một ô đã khai đúng là chỉ còn đường đóng cả drawer, mất luôn mọi thứ khai dở.
    const user = userEvent.setup();
    function Bang() {
      const [v, setV] = useState<MayCongDoanRow[]>([{ may_id: 1, cong_thuc_gia: "sl_vao * 420" }]);
      return <MayCuaCongDoanField value={v} options={MAY}
        nhomCongDoan="print" onChange={setV} />;
    }
    render(<AuthContext.Provider value={AUTH}><Bang /></AuthContext.Provider>);

    const o = () => screen.getByTitle("Sửa cách tính giá của máy này");
    await user.click(o());
    await user.click(screen.getByRole("button", { name: "×" }));
    expect(o().textContent).toBe("sl_vao * 420 *");

    await user.click(screen.getByRole("button", { name: "Huỷ" }));
    expect(o().textContent).toBe("sl_vao * 420");

    await user.click(o());
    await user.click(screen.getByRole("button", { name: "×" }));
    await user.click(screen.getByRole("button", { name: "Xong" }));
    expect(screen.queryByRole("dialog", { name: "Công thức giá" })).toBeNull();
    expect(o().textContent).toBe("sl_vao * 420 *");
  });

  it("công đoạn KHÔNG thuộc nhóm In thì không có ô công thức giá", async () => {
    const user = userEvent.setup();
    bay({ value: [{ may_id: 2 }], options: MAY, nhomCongDoan: "finishing",
          onChange: () => {} });
    await user.click(screen.getByRole("button", { name: /Yawa 1050/ }));
    expect(screen.getByText(/^Công thức giờ chạy — /)).toBeInTheDocument();
    expect(screen.queryByText("Công thức giá")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Sửa cách tính giá của máy này")).not.toBeInTheDocument();
  });
  it("popup TRỐNG mời lấy công thức chung hoặc chép từ máy khác; tiêu đề ghi tên máy", async () => {
    const user = userEvent.setup();
    function Bang() {
      const [v, setV] = useState<MayCongDoanRow[]>([
        { may_id: 1, cong_thuc_gia: "sl_vao * 420" }, { may_id: 2, cong_thuc_gia: null }]);
      return <MayCuaCongDoanField value={v} options={MAY}
        nhomCongDoan="print" congThucChung="sl_vao * 999" onChange={setV} />;
    }
    render(<AuthContext.Provider value={AUTH}><Bang /></AuthContext.Provider>);
    const oGia = () => screen.getAllByTitle("Sửa cách tính giá của máy này");

    await user.click(oGia()[1]);
    expect(screen.getByText("Công thức giá riêng — MAY-02 · Yawa 1050")).toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox", { name: "Chép từ máy" }), "1");
    expect(oGia()[1].textContent).toBe("sl_vao * 420");
    // Ô đã có công thức ⇒ lối "bắt đầu từ" rút đi, không ai lỡ tay đè.
    expect(screen.queryByRole("combobox", { name: "Chép từ máy" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Huỷ" }));
    expect(oGia()[1].textContent).toBe("—");
    await user.click(oGia()[1]);
    await user.click(screen.getByRole("button", { name: "Công thức chung của công đoạn" }));
    expect(oGia()[1].textContent).toBe("sl_vao * 999");
  });
});
