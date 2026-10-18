import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import BuocVatTu, { nhanNgan, soOChipTrong } from "./BuocVatTu";

vi.mock("./tenDonVi", () => ({
  useNapTenDonVi: () => 1,
  tenDonVi: (ma?: string | null) => ({ mm: "milimét", ghi: "gam" } as Record<string, string>)[ma ?? ""],
}));

const DM = [
  { id: 1, ma: "SUP", ten: "Support", chips: [
    { ma: "dai_support", ten: "Dài support", don_vi: "mm" },
    { ma: "rong_support", ten: "Rộng support", don_vi: "mm" } ] },
  { id: 2, ma: "KEO", ten: "Keo dán", chips: [] },
];
let n = 0;
const props = (over = {}) => ({
  tenBuoc: "Cán màng", dong: [], vatTuDm: DM as never, onChange: vi.fn(), taoUid: () => `u${++n}`, ...over,
});

describe("BuocVatTu", () => {
  it("bước chưa có vật tư: một dòng 'Chưa có vật tư.' + ô thêm vật tư", () => {
    const { container } = render(<BuocVatTu {...props()} />);
    expect(screen.getByText("Chưa có vật tư.")).toBeTruthy();
    expect(container.querySelectorAll(".tg-bvt__dong").length).toBe(0);
    expect(screen.getByRole("button", { name: /Thêm vật tư vào bước Cán màng/ }).textContent).toMatch(/Thêm vật tư/);
  });

  it("vật tư có chip → mọc đúng ô nhập, gõ số báo ra ngoài", () => {
    const onChange = vi.fn();
    render(<BuocVatTu {...props({ onChange, dong: [{ uid: "a", hang_loai: "vat_tu", vat_tu_id: 1, gia_tri_chip: {} }] })} />);
    fireEvent.change(screen.getByLabelText(/Dài support/), { target: { value: "5" } });
    expect(onChange).toHaveBeenCalledWith([{ uid: "a", hang_loai: "vat_tu", vat_tu_id: 1, gia_tri_chip: { dai_support: 5 } }]);
    expect(screen.getByLabelText(/Rộng support/)).toBeTruthy();
  });

  it("đơn vị hiện bằng TÊN trong danh mục, mã lạ thì không in mã trần", () => {
    const dm = [{ id: 3, ma: "X", ten: "Cũ", chips: [{ ma: "a", ten: "Dài", don_vi: "mm" }, { ma: "b", ten: "Rộng", don_vi: "khong_co" }] }];
    render(<BuocVatTu {...props({ vatTuDm: dm as never, dong: [{ uid: "c", hang_loai: "vat_tu", vat_tu_id: 3, gia_tri_chip: {} }] })} />);
    expect(screen.getByText("milimét")).toBeTruthy();
    expect(screen.queryByText("mm")).toBeNull();
    expect(screen.queryByText("khong_co")).toBeNull();
  });

  it("vật tư không chip thì không có ô nhập", () => {
    render(<BuocVatTu {...props({ dong: [{ uid: "b", hang_loai: "vat_tu", vat_tu_id: 2, gia_tri_chip: {} }] })} />);
    expect(screen.queryByRole("spinbutton")).toBeNull();
  });

  it("xoá bớt và thêm vật tư chưa có", () => {
    const onChange = vi.fn();
    render(<BuocVatTu {...props({ onChange, dong: [{ uid: "a", hang_loai: "vat_tu", vat_tu_id: 1, gia_tri_chip: {} }] })} />);
    fireEvent.click(screen.getByRole("button", { name: /Xóa Support/ }));
    expect(onChange).toHaveBeenLastCalledWith([]);
    fireEvent.click(screen.getByRole("button", { name: /Thêm vật tư vào bước/ }));
    fireEvent.mouseDown(screen.getByRole("option", { name: /Keo dán/ }));
    expect(onChange).toHaveBeenLastCalledWith([
      { uid: "a", hang_loai: "vat_tu", vat_tu_id: 1, gia_tri_chip: {} }, { uid: "u1", hang_loai: "vat_tu", vat_tu_id: 2, gia_tri_chip: {} }]);
  });

  it("ô để trống → bỏ khỏi gia_tri_chip (không gửi NaN)", () => {
    const onChange = vi.fn();
    render(<BuocVatTu {...props({ onChange, dong: [{ uid: "a", hang_loai: "vat_tu", vat_tu_id: 1, gia_tri_chip: { dai_support: 5 } }] })} />);
    fireEvent.change(screen.getByLabelText(/Dài support/), { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith([{ uid: "a", hang_loai: "vat_tu", vat_tu_id: 1, gia_tri_chip: {} }]);
  });

  it("ô chip hiện NHÃN NGẮN, tên đầy đủ vẫn ở tooltip + aria-label", () => {
    render(<BuocVatTu {...props({ dong: [{ uid: "a", hang_loai: "vat_tu", vat_tu_id: 1, gia_tri_chip: {} }] })} />);
    expect(screen.getByText("Dài")).toBeTruthy();
    expect(screen.getByText("Rộng")).toBeTruthy();
    expect(screen.queryByText("Dài support")).toBeNull();
    const o = screen.getByLabelText("Dài support");
    expect(o.closest("label")?.getAttribute("title")).toMatch(/^Dài support/);
  });

  it("ô chip chưa có số thì viền cảnh báo, có số thì hết", () => {
    render(<BuocVatTu {...props({ dong: [{ uid: "a", hang_loai: "vat_tu", vat_tu_id: 1, gia_tri_chip: { dai_support: 5 } }] })} />);
    expect(screen.getByLabelText("Dài support").closest("label")?.className).not.toMatch(/--trong/);
    expect(screen.getByLabelText("Rộng support").closest("label")?.className).toMatch(/tg-bvt__o--trong/);
  });

  it("chưa nhập ≠ đã nhập 0: ô trống không placeholder \"0\", ô 0 hiện 0 viền thường", () => {
    const onChange = vi.fn();
    render(<BuocVatTu {...props({ onChange, dong: [{ uid: "a", hang_loai: "vat_tu", vat_tu_id: 1, gia_tri_chip: { dai_support: 0 } }] })} />);
    const dai = screen.getByLabelText("Dài support") as HTMLInputElement;
    const rong = screen.getByLabelText("Rộng support") as HTMLInputElement;
    expect(dai.value).toBe("0");
    expect(dai.closest("label")?.className).not.toMatch(/--trong/);
    expect(rong.value).toBe("");
    expect(rong.getAttribute("placeholder") ?? "").toBe("");
    expect(rong.closest("label")?.className).toMatch(/--trong/);
    fireEvent.change(rong, { target: { value: "0" } });
    expect(onChange).toHaveBeenLastCalledWith([
      { uid: "a", hang_loai: "vat_tu", vat_tu_id: 1, gia_tri_chip: { dai_support: 0, rong_support: 0 } }]);
  });

  it("mỗi vật tư một hàng [tên, lượng, ×]; vật tư có chip đứng trước và thêm dòng ô chip", () => {
    const dm = [...DM, { id: 4, ma: "MUC", ten: "Mực", don_vi_gia: "ghi", chips: [] }];
    const { container } = render(<BuocVatTu {...props({ vatTuDm: dm as never, dong: [
      { uid: "b", hang_loai: "vat_tu", vat_tu_id: 4, gia_tri_chip: {} }, { uid: "a", hang_loai: "vat_tu", vat_tu_id: 1, gia_tri_chip: {} }] })} />);
    const hang = Array.from(container.querySelectorAll(".tg-bvt__ds > li"));
    expect(hang.map((e) => e.className)).toEqual(["tg-bvt__dong tg-bvt__dong--chip", "tg-bvt__dong"]);
    expect(Array.from(hang[0].children).map((e) => e.className))
      .toEqual(["tg-bvt__ten", "tg-bvt__luong tg-bvt__luong--chua", "tg-bvt__xoa", "tg-bvt__luoi"]);
    expect(hang[0].querySelector(".tg-bvt__ten")?.textContent).toBe("Support");
    expect(Array.from(hang[1].children).map((e) => e.className))
      .toEqual(["tg-bvt__ten", "tg-bvt__luong tg-bvt__luong--chua", "tg-bvt__xoa"]);
    expect(hang[1].querySelector(".tg-bvt__luong-so")?.textContent).toBe("—");
    expect(hang[1].querySelector(".tg-bvt__dv")?.textContent).toBe("gam");
    expect(container.querySelector('[aria-label^="Thêm vật tư vào bước"]')).toBeTruthy();
  });

  it("vật tư 5 chip: đủ 5 ô trên MỘT hàng, nhãn đứng trước khung ô", () => {
    const ten = ["Dài", "Rộng", "Số dao", "Dài đường bế", "Độ dày"];
    const dm = [{ id: 9, ma: "KB", ten: "Khuôn bế", chips: ten.map((t, k) => ({ ma: `c${k}`, ten: t, don_vi: "mm" })) }];
    const { container } = render(<BuocVatTu {...props({ vatTuDm: dm as never, dong: [
      { uid: "k", hang_loai: "vat_tu", vat_tu_id: 9, gia_tri_chip: { c0: 420 } }] })} />);
    const luoi = container.querySelectorAll(".tg-bvt__luoi");
    expect(luoi).toHaveLength(1);
    const o = luoi[0].querySelectorAll(".tg-bvt__o");
    expect(o).toHaveLength(5);
    expect(Array.from(o[0].children).map((e) => e.className)).toEqual(["tg-bvt__o-nhan", "tg-bvt__o-khung"]);
    expect(container.querySelectorAll(".tg-bvt__o--trong")).toHaveLength(4);
  });
});

describe("BuocVatTu — giấy là vật tư của bước", () => {
  const GIAY = [{ id: 1, ma: "C150", ten: "Couche 150", don_vi_gia: "kg" },
                { id: 7, ma: "OLD", ten: "Giấy ngừng", active: false }];

  it("ô thêm có nhóm Giấy đứng trước nhóm Vật tư, giấy ngừng dùng không mời", () => {
    const { container } = render(<BuocVatTu {...props({ giayDm: GIAY as never })} />);
    fireEvent.click(screen.getByRole("button", { name: /Thêm vật tư vào bước/ }));
    const nhom = Array.from(document.querySelectorAll(".sel__group")).map((e) => e.textContent);
    expect(nhom).toEqual(["Giấy", "Vật tư"]);
    expect(screen.queryByRole("option", { name: /Giấy ngừng/ })).toBeNull();
    expect(container).toBeTruthy();
  });

  it("chọn giấy thêm dòng hang_loai giay; giấy và vật tư cùng id không lẫn nhau", () => {
    const onChange = vi.fn();
    const dong = [{ uid: "a", hang_loai: "vat_tu", vat_tu_id: 1, gia_tri_chip: {} }];
    render(<BuocVatTu {...props({ onChange, giayDm: GIAY as never, dong })} />);
    // Vật tư #1 (Support) đã có, giấy #1 (Couche 150) vẫn được mời.
    fireEvent.click(screen.getByRole("button", { name: /Thêm vật tư vào bước/ }));
    expect(screen.queryByRole("option", { name: /^Support/ })).toBeNull();
    fireEvent.mouseDown(screen.getByRole("option", { name: /Couche 150/ }));
    expect(onChange).toHaveBeenLastCalledWith([...dong,
      { uid: expect.any(String), hang_loai: "giay", vat_tu_id: 1, gia_tri_chip: {} }]);
  });

  it("dòng giấy hiện tên giấy, không ô chip, lượng tra theo khoá giay:id", () => {
    const dinhMuc = new Map([["giay:1", { so: 2_600, donVi: "to", lyDo: null }],
                             ["vat_tu:1", { so: 3, donVi: "mm", lyDo: null }]]);
    const { container } = render(<BuocVatTu {...props({ giayDm: GIAY as never, dinhMuc, dong: [
      { uid: "g", hang_loai: "giay", vat_tu_id: 1, gia_tri_chip: {} }] })} />);
    expect(container.querySelector(".tg-bvt__ten")?.textContent).toBe("Couche 150");
    expect(container.querySelector(".tg-bvt__luoi")).toBeNull();
    expect(container.querySelector(".tg-bvt__luong-so")?.textContent).toBe("2.600");
  });
});

describe("soOChipTrong", () => {
  it("đếm ô chưa nhập theo chip danh mục; đã nhập 0 không tính", () => {
    expect(soOChipTrong([
      { uid: "a", hang_loai: "vat_tu", vat_tu_id: 1, gia_tri_chip: { dai_support: 0 } },
      { uid: "b", hang_loai: "vat_tu", vat_tu_id: 2, gia_tri_chip: {} },
    ], DM as never)).toBe(1);
    expect(soOChipTrong([], DM as never)).toBe(0);
    // Dòng giấy cùng id với vật tư có chip KHÔNG bị đếm chip.
    expect(soOChipTrong([{ uid: "g", hang_loai: "giay", vat_tu_id: 1, gia_tri_chip: {} }], DM as never)).toBe(0);
  });
});

describe("nhanNgan", () => {
  it("bỏ cụm trùng tên vật tư, không phân biệt hoa thường/dấu", () => {
    expect(nhanNgan("Dài support", "Support")).toBe("Dài");
    expect(nhanNgan("Định lượng support", "SUPPORT")).toBe("Định lượng");
    expect(nhanNgan("Độ dày màng BOPP", "mang bopp")).toBe("Độ dày");
  });
  it("bỏ xong rỗng hoặc không trùng thì giữ nguyên tên chip", () => {
    expect(nhanNgan("Support", "Support")).toBe("Support");
    expect(nhanNgan("Chiều dài", "Support")).toBe("Chiều dài");
    expect(nhanNgan("Supportx dài", "Support")).toBe("Supportx dài");
  });
});

describe("BuocVatTu — định mức", () => {
  it("hiện lượng engine tính theo công thức định mức + tên đơn vị; chưa tính được thì gạch kèm lý do", () => {
    const dinhMuc = new Map([
      ["vat_tu:1", { so: 0.0012, donVi: "mm", lyDo: null, dienGiai: "Dài support × Rộng support ÷ 10000",
            thaySo: "3 milimét × 4 milimét ÷ 10000" }],
      ["vat_tu:2", { so: null, donVi: "ghi", lyDo: "chưa khai công thức định mức" }],
    ]);
    const { container } = render(<BuocVatTu {...props({ dinhMuc, dong: [
      { uid: "a", hang_loai: "vat_tu", vat_tu_id: 1, gia_tri_chip: {} }, { uid: "b", hang_loai: "vat_tu", vat_tu_id: 2, gia_tri_chip: {} }] })} />);
    const luong = container.querySelectorAll(".tg-bvt__luong");
    expect(luong[0].querySelector(".tg-bvt__luong-so")?.textContent).toBe("0,0012");
    expect(luong[0].querySelector(".tg-bvt__dv")?.textContent).toBe("milimét");
    expect(luong[1].querySelector(".tg-bvt__luong-so")?.textContent).toBe("—");
    fireEvent.mouseEnter(luong[1]);
    expect(screen.getByRole("tooltip").textContent).toMatch(/chưa khai công thức định mức/);
  });

  it("bong bóng: thẻ Công thức bằng chữ, thẻ Thế số '= thế số = kết quả'; công thức một biến thì chỉ '= số'", () => {
    const dinhMuc = new Map([
      ["vat_tu:1", { so: 0.0012, donVi: "mm", lyDo: null, dienGiai: "Dài support × Rộng support ÷ 10000",
            thaySo: "3 milimét × 4 milimét ÷ 10000" }],
      ["vat_tu:2", { so: 32, donVi: "ghi", lyDo: null, dienGiai: "Số bản kẽm", thaySo: "32 bản" }],
    ]);
    const { container } = render(<BuocVatTu {...props({ dinhMuc, dong: [
      { uid: "a", hang_loai: "vat_tu", vat_tu_id: 1, gia_tri_chip: {} }, { uid: "b", hang_loai: "vat_tu", vat_tu_id: 2, gia_tri_chip: {} }] })} />);
    const luong = container.querySelectorAll(".tg-bvt__luong");
    const dd = () => Array.from(screen.getByRole("tooltip").querySelectorAll("dd")).map((x) => x.textContent);
    fireEvent.mouseEnter(luong[0]);
    expect(dd()).toEqual(["Dài support × Rộng support ÷ 10000", "= 3 milimét × 4 milimét ÷ 10000 = 0,0012 milimét"]);
    fireEvent.mouseLeave(luong[0]);
    fireEvent.mouseEnter(luong[1]);
    expect(dd()).toEqual(["Số bản kẽm", "= 32 bản"]);
    // Ô lượng nhận focus để chạm / bàn phím cũng mở được bong bóng.
    expect(luong[0].getAttribute("tabindex")).toBe("0");
  });
});
