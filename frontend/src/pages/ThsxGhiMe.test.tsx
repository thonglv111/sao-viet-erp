import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SxHoTroUngVien, SxNguoiGhi, SxTranGhi, SxWorkItemChiTiet } from "../api/client";
import { BatchForm, type NguoiToKhac, type ThsxExec } from "./ThsxExecPanels";

const cv = {
  id: 1, department_id: 7, ten_cong_doan: "Cắt tờ", loai_buoc: "to", nguon_ma: "LSX26-0004",
  don_vi_ra: "to", don_vi_vao: "to",
} as SxWorkItemChiTiet["cong_viec"];

const TRAN: SxTranGhi = {
  cung_to: true, nguon_ten: "In", da_nhan: 350, da_ghi: 200, toi_da: 350, toi_da_nhan: 350, loi_kcs: 0,
  dau_chuoi: false, he_so: 1, con_ghi_duoc: 150, don_vi_nhan: "to",
};

const nguoi = (id: number, ten: string, x: Partial<SxNguoiGhi> = {}): SxNguoiGhi => ({
  employee_id: id, ho_ten: ten, nghi: null, dang_o: [], tick_san: true, ...x,
});
const NGUOI = [nguoi(1, "Đào Văn Hoan")];
const ung = (id: number, ten: string, extra: Partial<SxHoTroUngVien> = {}): SxHoTroUngVien => ({
  id, code: `NV${id}`, full_name: ten, to_id: 3, to_ten: "Bế T - Bằng", ly_do_nghi: null, nghi_phep: [],
  dang_chay: null, viec_cho: [], ...extra,
});

function mo(tranGhi: SxTranGhi | null = null, nguoiGhi: SxNguoiGhi[] = NGUOI, toKhac?: NguoiToKhac) {
  const taoBatch = vi.fn().mockResolvedValue([]);
  const onXong = vi.fn();
  render(<BatchForm cv={cv} khoan={null} busy={false} tranGhi={tranGhi}
    nguoiGhi={nguoiGhi} toKhac={toKhac} onXong={onXong} exec={{ taoBatch } as unknown as ThsxExec} />);
  const hop = screen.getByRole("dialog", { name: "Ghi sản lượng" });
  return { hop, taoBatch, onXong };
}

describe("Hộp Ghi mẻ (phương án B)", () => {
  // Cố định đồng hồ: ngày xét nghỉ phép của người tổ khác là hôm nay.
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(2026, 9, 9, 8, 40)); });
  afterEach(() => { vi.useRealTimers(); });

  it("đầu hộp ghi công đoạn của lệnh, chân có gợi ý phím tắt; không có ô giờ (giờ theo lúc bấm ghi)", () => {
    const { hop } = mo();
    expect(within(hop).queryByLabelText("Bắt đầu")).toBeNull();
    expect(within(hop).queryByLabelText("Kết thúc")).toBeNull();
    expect(within(hop).queryByRole("button", { name: "Bây giờ" })).toBeNull();
    expect(within(hop).getByText("Cắt tờ của LSX26-0004")).toBeInTheDocument();
    expect(within(hop).getByText("Ctrl + Enter để ghi")).toBeInTheDocument();
    expect(within(hop).getByPlaceholderText("Không bắt buộc")).toBeInTheDocument();
  });

  it("chip cộng nhanh, Tối đa và Về 0", () => {
    const { hop } = mo(TRAN);
    const o = within(hop).getByLabelText("Số lượng làm được") as HTMLInputElement;
    fireEvent.click(within(hop).getByRole("button", { name: "+50" }));
    fireEvent.click(within(hop).getByRole("button", { name: "+50" }));
    expect(o.value).toBe("100");
    fireEvent.click(within(hop).getByRole("button", { name: "Tối đa 150" }));
    expect(o.value).toBe("150");
    fireEvent.click(within(hop).getByRole("button", { name: "Về 0" }));
    expect(o.value).toBe("0");
    expect(within(hop).queryByText(/Max/)).toBeNull();
    expect(within(hop).getAllByRole("button", { name: /Tối đa/ })).toHaveLength(1);
  });

  it("nói số còn ghi được, số đã ghi, và gõ số thì nói sau lần này tới đâu", () => {
    const { hop } = mo(TRAN);
    expect(within(hop).getByText(/^còn ghi được/)).toHaveTextContent(/^còn ghi được 150/);
    expect(within(hop).getByText(/^Đã ghi 200 trên 350/)).toBeInTheDocument();
    fireEvent.change(within(hop).getByLabelText("Số lượng làm được"), { target: { value: "100" } });
    expect(within(hop).getByText(/^Sau lần này 300 trên 350/)).toBeInTheDocument();
  });

  it("lỗi KCS trừ khỏi trần: bước đầu chuỗi theo kế hoạch, câu nói rõ trừ bao nhiêu", () => {
    const { hop } = mo({
      ...TRAN, cung_to: false, nguon_ten: null, dau_chuoi: true, da_nhan: 175, he_so: 2,
      toi_da_nhan: 350, loi_kcs: 18, toi_da: 332, da_ghi: 300, con_ghi_duoc: 32, don_vi_nhan: "to_nguyen",
    });
    // Nhãn đơn vị đọc từ danh mục — test không nạp danh mục nên còn mã "to".
    expect(within(hop).getByText(/^còn ghi được/)).toHaveTextContent(/^còn ghi được 32 (tờ|to)$/);
    expect(within(hop).getByText(/^Đã ghi 300 trên 332/)).toBeInTheDocument();
    expect(within(hop).getByText(/^Kế hoạch nhận 175 × 2 = 350, trừ 18 KCS bắt lỗi còn 332 (tờ|to)\.$/)).toBeInTheDocument();
    expect(within(hop).getByRole("button", { name: "Tối đa 32" })).toBeInTheDocument();
  });

  it("gõ vượt thì báo và khoá nút Ghi mẻ", () => {
    const { hop } = mo(TRAN);
    fireEvent.change(within(hop).getByLabelText("Số lượng làm được"), { target: { value: "180" } });
    expect(within(hop).getByText(/^Vượt số còn ghi được, lần này ghi tối đa 150/)).toBeInTheDocument();
    expect(within(hop).getByRole("button", { name: "Ghi sản lượng" })).toBeDisabled();
  });

  it("không có trần thì không có khối Mẻ này ghi tối đa", () => {
    const { hop } = mo(null);
    expect(within(hop).queryByText(/còn ghi được/)).toBeNull();
    expect(within(hop).queryByRole("button", { name: /Tối đa/ })).toBeNull();
  });

  it("Ctrl + Enter gửi đúng số lượng", () => {
    const { hop, taoBatch } = mo(TRAN);
    fireEvent.click(within(hop).getByRole("button", { name: "+100" }));
    fireEvent.keyDown(hop, { key: "Enter", ctrlKey: true });
    expect(taoBatch).toHaveBeenCalledTimes(1);
    expect(taoBatch.mock.calls[0][0]).toMatchObject({ tong: 100, tot: 100, hong: 0 });
    // Không gửi giờ: máy chủ lấy lúc bấm, bắt đầu nối lần ghi trước.
    expect(taoBatch.mock.calls[0][0]).not.toHaveProperty("bat_dau");
    expect(taoBatch.mock.calls[0][0]).not.toHaveProperty("ket_thuc");
  });
});

describe("Người làm lần này", () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(2026, 9, 9, 8, 40)); });
  afterEach(() => { vi.useRealTimers(); });

  it("tick sẵn người đi làm, người nghỉ mờ; thẻ ghi LSX và công đoạn", () => {
    const viec = { cong_viec_id: 5, ma: "LSX26-0004", ten_cong_doan: "Cắt tờ" };
    const { hop } = mo(null, [
      nguoi(1, "Đào Văn Hoan", { dang_o: [viec] }),
      nguoi(3, "Ngô Thị Hạnh", { nghi: "Nghỉ phép", tick_san: false }),
    ]);
    const ds = within(hop).getByRole("list", { name: "Người làm lần này" });
    const o = (ten: string) => within(ds).getByRole("checkbox", { name: new RegExp(ten) });
    expect(o("Đào Văn Hoan")).toBeChecked();
    expect(within(ds).getByText("đang ở LSX26-0004 Cắt tờ")).toBeInTheDocument();
    expect(o("Ngô Thị Hạnh")).toBeDisabled();
    expect(within(hop).getByText("1 người")).toBeInTheDocument();
  });

  it("người đang ở nhiều việc: một thẻ gọn, đủ danh sách ở chú thích — không dàn hàng chục thẻ", () => {
    const viec = (i: number) => ({ cong_viec_id: i, ma: `T08-${i}`, ten_cong_doan: "Dán" });
    const { hop } = mo(null, [nguoi(1, "Trần Tùng", { dang_o: [viec(1), viec(2), viec(3)] })]);
    const ds = within(hop).getByRole("list", { name: "Người làm lần này" });
    const the = within(ds).getByText("đang ở T08-1 Dán và 2 việc khác");
    expect(the).toHaveAttribute("title", "T08-1 Dán\nT08-2 Dán\nT08-3 Dán");
    expect(within(ds).queryByText(/T08-2/)).toBeNull();
  });

  it("popup chọn tổ rồi chọn người: người nghỉ hôm đó hoặc đã nghỉ việc không tick được; thêm vào danh sách kèm tên tổ, tick sẵn, gửi cùng", () => {
    const { hop, taoBatch } = mo(null, [nguoi(1, "Đào Văn Hoan")], {
      ds: [
        ung(8, "Nguyễn Hữu Bằng"),
        ung(9, "Trần Văn Khoa", { nghi_phep: [{ tu: "2026-10-09", den: "2026-10-09" }] }),
        ung(10, "Phạm Thu", { to_id: 5, to_ten: "Cán màng", ly_do_nghi: "Đã nghỉ việc" }),
        ung(11, "Võ Quốc Nhựt", { to_id: 5, to_ten: "Cán màng" }),
      ],
      homNay: "2026-10-09",
    });
    fireEvent.click(within(hop).getByRole("button", { name: /Thêm người tổ khác/ }));
    let pop = screen.getByRole("dialog", { name: "Thêm người tổ khác" });
    expect(within(pop).getByRole("button", { name: "Thêm" })).toBeDisabled();
    // Bước 1: chọn tổ.
    expect(within(pop).getByRole("button", { name: /Cán màng\s*2 người/ })).toBeInTheDocument();
    fireEvent.click(within(pop).getByRole("button", { name: /Bế T - Bằng\s*2 người/ }));
    // Bước 2: tick người của tổ đó.
    expect(within(pop).getByRole("checkbox", { name: /Trần Văn Khoa/ })).toBeDisabled();
    expect(within(pop).getByText("Nghỉ phép hôm nay")).toBeInTheDocument();
    fireEvent.click(within(pop).getByRole("checkbox", { name: /Nguyễn Hữu Bằng/ }));
    fireEvent.click(within(pop).getByRole("button", { name: /Chọn tổ khác/ }));
    fireEvent.click(within(pop).getByRole("button", { name: /Cán màng/ }));
    expect(within(pop).getByRole("checkbox", { name: /Phạm Thu/ })).toBeDisabled();
    fireEvent.click(within(pop).getByRole("checkbox", { name: /Võ Quốc Nhựt/ }));
    fireEvent.click(within(pop).getByRole("button", { name: "Thêm 2 người" }));
    expect(screen.queryByRole("dialog", { name: "Thêm người tổ khác" })).toBeNull();

    const ds = within(hop).getByRole("list", { name: "Người làm lần này" });
    expect(within(ds).getByRole("checkbox", { name: /Nguyễn Hữu Bằng/ })).toBeChecked();
    expect(within(ds).getByRole("checkbox", { name: /Võ Quốc Nhựt/ })).toBeChecked();
    expect(within(ds).getByText("Bế T - Bằng")).toBeInTheDocument();
    expect(within(ds).getByText("Cán màng")).toBeInTheDocument();
    expect(within(hop).getByText("3 người")).toBeInTheDocument();
    // Người đã ở danh sách không hiện lại trong popup.
    fireEvent.click(within(hop).getByRole("button", { name: /Thêm người tổ khác/ }));
    pop = screen.getByRole("dialog", { name: "Thêm người tổ khác" });
    expect(within(pop).getByRole("button", { name: /Bế T - Bằng\s*1 người/ })).toBeInTheDocument();
    fireEvent.click(within(pop).getByRole("button", { name: "Huỷ" }));

    fireEvent.change(within(hop).getByLabelText("Số lượng làm được"), { target: { value: "50" } });
    fireEvent.keyDown(hop, { key: "Enter", ctrlKey: true });
    expect(taoBatch.mock.calls[0][0].nguoi_ids).toEqual([1, 8, 11]);
  });

  it("không truyền thợ tổ khác thì không có ô thêm", () => {
    const { hop } = mo(null);
    expect(within(hop).queryByRole("button", { name: /Thêm người tổ khác/ })).toBeNull();
  });

  it("bỏ tick hết thì báo và khoá nút Ghi sản lượng", () => {
    const { hop } = mo(null);
    fireEvent.change(within(hop).getByLabelText("Số lượng làm được"), { target: { value: "50" } });
    fireEvent.click(within(hop).getByRole("checkbox", { name: /Đào Văn Hoan/ }));
    expect(within(hop).getByText("Chọn ít nhất một người làm lần này.")).toBeInTheDocument();
    expect(within(hop).getByRole("button", { name: "Ghi sản lượng" })).toBeDisabled();
  });
});
