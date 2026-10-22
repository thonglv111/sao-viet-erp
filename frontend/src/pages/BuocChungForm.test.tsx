import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { api } from "../api/client";
import { gop } from "../test/baiGhepSoDoFixture";
import { BuocChungForm } from "./BaiGhepBuocChungForm";

vi.mock("../auth/useAuth", () => ({ useAuth: () => ({ token: "token-test" }) }));
// Danh mục nạp qua `crud(prefix).list` — chỉ ô TỔ cần dữ liệu thật, các prefix khác trả rỗng.
vi.mock("../api/rebuildCatalog", () => ({
  crud: (prefix: string) => ({
    list: vi.fn().mockResolvedValue({
      items: prefix === "/api/cong-doan/phong-ban"
        ? [
            { id: 3, ten: "Tổ in" },
            { id: 5, ten: "Tổ cán phủ" },
            { id: 7, ten: "Tổ bế" },
            { id: 9, ten: "Tổ dán" },
          ]
        : prefix === "/api/may-thiet-bi"
          ? [{ id: 56, ten: "Máy 4 màu", active: true, toc_do: 6000,
               don_vi_toc_do: "to_gio", don_vi_toc_do_ten: "tờ in" },
             { id: 57, ten: "Máy A", active: true, to_ids: [3, 5] },
             { id: 58, ten: "Máy B", active: true, to_ids: [3, 5] },
             { id: 59, ten: "Máy C", active: true, to_ids: [3] },
             { id: 60, ten: "Máy D", active: true, to_ids: [3] }]
          : [],
    }),
  }),
}));

describe("form kế hoạch bước chung", () => {
  it("server từ chối thì giữ nguyên draft và form vẫn mở", async () => {
    const user = userEvent.setup();
    const onLuu = vi.fn().mockResolvedValue(false);
    render(<BuocChungForm g={gop({
      step_key: "gang-in",
      ten: "In chung",
      thanh_vien: [
        { lsx_id: 1, lsx_ma: "LSX-1", lsx_step_key: "lsx-1-in", ghi_chu_ky_thuat: null },
        { lsx_id: 2, lsx_ma: "LSX-2", lsx_step_key: "lsx-2-in", ghi_chu_ky_thuat: null },
      ],
    })} canUpdate onLuu={onLuu} onTach={async () => {}} />);

    // Ghi chú của bài nằm ở tab cuối (cùng chỗ với ghi chú kỹ thuật của từng lệnh trên tờ).
    await user.click(screen.getByRole("button", { name: /Các lệnh trên tờ/ }));
    const note = screen.getByLabelText("Ghi chú của bài cho lượt chạy này");
    await user.clear(note);
    await user.type(note, "Giữ nội dung đang khai");
    await user.click(screen.getByRole("button", { name: "Lưu kế hoạch lượt chung" }));

    expect(onLuu).toHaveBeenCalledWith(expect.objectContaining({ ghi_chu: "Giữ nội dung đang khai" }));
    expect(note).toHaveValue("Giữ nội dung đang khai");
    expect(screen.getByRole("button", { name: "Lưu kế hoạch lượt chung" })).toBeInTheDocument();
  });

  // Nhiều tổ phụ trách (18/09/2026): ô TỔ của lượt chung chỉ mời các tổ khai ở danh mục Công đoạn.
  it("ô Tổ phụ trách chỉ mời các tổ phụ trách công đoạn, giữ cả tổ đang gán lệch", async () => {
    render(<BuocChungForm g={gop({
      step_key: "gang-can",
      ten: "Cán màng chung",
      to_chon_duoc: [5, 7],
      department_id: 9,
      to_ten: "Tổ dán",
      thanh_vien: [{ lsx_id: 1, lsx_ma: "LSX-1", lsx_step_key: "lsx-1-can", ghi_chu_ky_thuat: null }],
    })} canUpdate onLuu={async () => true} onTach={async () => {}} />);

    await userEvent.setup().click(screen.getByRole("button", { name: /Phân công & Thiết bị/ }));
    const sel = await screen.findByLabelText(/TỔ PHỤ TRÁCH/);
    expect([...(sel as HTMLSelectElement).options].map((o) => o.text)).toEqual([
      "— chọn tổ —", "Tổ cán phủ", "Tổ bế", "Tổ dán (không còn phụ trách công đoạn)",
    ]);
    expect((sel as HTMLSelectElement).value).toBe("9");
    expect(screen.getByText(/Chỉ các tổ phụ trách khai ở danh mục Công đoạn/)).toBeInTheDocument();
  });

  // Spec 2026-09-27 §2 bước 1: lượt chung kế thừa loại "Máy" từ bước lệnh vẫn đổi sang "Thuê ngoài"
  // được ngay trên form bài ghép — không có đường này thì UI không thể dựng bước chung gia công ngoài.
  it("đổi loại bước sang Thuê ngoài thì ẩn tổ/máy, mở thẻ nhà gia công và lưu cả hai", async () => {
    const user = userEvent.setup();
    vi.spyOn(api.giaCongNgoai, "nhaGiaCong").mockResolvedValue([{ id: 41, ten: "Tân Phát" }]);
    const onLuu = vi.fn().mockResolvedValue(true);
    render(<BuocChungForm g={gop({
      step_key: "gang-can-2",
      ten: "Cán màng chung",
      loai_buoc: "may",
      thanh_vien: [{ lsx_id: 1, lsx_ma: "LSX-1", lsx_step_key: "lsx-1-can", ghi_chu_ky_thuat: null }],
    })} canUpdate onLuu={onLuu} onTach={async () => {}} />);

    await user.click(screen.getByRole("button", { name: /Phân công & Thiết bị/ }));
    await user.click(screen.getByRole("button", { name: "Thuê ngoài" }));

    expect(screen.queryByLabelText(/TỔ PHỤ TRÁCH/)).toBeNull();
    const nha = await screen.findByLabelText(/NHÀ GIA CÔNG/);
    await screen.findByRole("option", { name: "Tân Phát" });
    await user.selectOptions(nha, "41");
    await user.click(screen.getByRole("button", { name: "Lưu kế hoạch lượt chung" }));

    expect(onLuu).toHaveBeenCalledWith(expect.objectContaining({
      loai_buoc: "thue_ngoai", nha_cung_cap_id: 41, department_id: null, may_id: null,
    }));
  });

  // E2E 27/09/2026: trang nạp lại sơ đồ SAU khi `onLuu` trả về — xoá nháp ngay lúc đó là form rơi về
  // bản cũ (loại Máy, tổ trống) và hiện ô "— chọn tổ —" dù bước đã lưu thành Thuê ngoài.
  it("lưu xong giữ nháp tới khi sơ đồ nạp lại, rồi mới đọc theo máy chủ", async () => {
    const user = userEvent.setup();
    vi.spyOn(api.giaCongNgoai, "nhaGiaCong").mockResolvedValue([{ id: 41, ten: "Tân Phát" }]);
    const cu = gop({
      step_key: "gang-can-3", ten: "Cán màng chung", loai_buoc: "may",
      thanh_vien: [{ lsx_id: 1, lsx_ma: "LSX-1", lsx_step_key: "lsx-1-can", ghi_chu_ky_thuat: null }],
    });
    const { rerender } = render(
      <BuocChungForm g={cu} canUpdate onLuu={async () => true} onTach={async () => {}} />);

    await user.click(screen.getByRole("button", { name: /Phân công & Thiết bị/ }));
    await user.click(screen.getByRole("button", { name: "Thuê ngoài" }));
    await user.selectOptions(await screen.findByLabelText(/NHÀ GIA CÔNG/), "41");
    await user.click(screen.getByRole("button", { name: "Lưu kế hoạch lượt chung" }));

    await user.click(screen.getByRole("button", { name: /Phân công & Thiết bị/ }));
    expect(screen.queryByLabelText(/TỔ PHỤ TRÁCH/)).toBeNull();

    const moi = { ...cu, loai_buoc: "thue_ngoai" as const, nha_cung_cap_id: 41, department_id: null };
    rerender(<BuocChungForm g={moi} canUpdate onLuu={async () => true} onTach={async () => {}} />);
    expect(screen.queryByLabelText(/TỔ PHỤ TRÁCH/)).toBeNull();
    expect(screen.getByRole("button", { name: "Thuê ngoài" })).toHaveAttribute("aria-pressed", "true");
    // Nháp đã xoá sau khi sơ đồ mới về: nút Lưu hết "đang sửa".
    expect(screen.getByRole("button", { name: "Lưu kế hoạch lượt chung" })).toBeDisabled();
  });

  // E2E 27/09/2026: gợi ý dưới ô máy in thẳng MÃ đơn vị tốc độ ("Tốc độ 6.000 to_gio/giờ").
  it("gợi ý tốc độ máy dịch đơn vị sang nhãn, không in mã trần", async () => {
    render(<BuocChungForm g={gop({
      step_key: "gang-in-3",
      ten: "In chung",
      may_id: 56,
      thanh_vien: [{ lsx_id: 1, lsx_ma: "LSX-1", lsx_step_key: "lsx-1-in", ghi_chu_ky_thuat: null }],
    })} canUpdate onLuu={async () => true} onTach={async () => {}} />);

    await userEvent.setup().click(screen.getByRole("button", { name: /Phân công & Thiết bị/ }));
    expect(await screen.findByText(/Tốc độ 6\.000 tờ in\/h/)).toBeInTheDocument();
    expect(screen.queryByText(/to_gio/)).toBeNull();
  });

  // Review 23/10/2026: ô máy lượt chung lấy máy theo thứ tự id và mời cả máy ngoài công đoạn (máy
  // chủ chặn lúc lưu). Nay cùng luật ngăn bước lệnh: chỉ máy của công đoạn, máy "Đặt mặc định" đầu.
  it("ô máy chỉ mời máy của công đoạn thuộc tổ, theo thứ tự máy mặc định; đổi tổ lấy máy đầu", async () => {
    const user = userEvent.setup();
    render(<BuocChungForm g={gop({
      step_key: "gang-in-4",
      ten: "In chung",
      to_chon_duoc: [3, 5],
      may_chon_duoc: [58, 60, 57],
      department_id: 3,
      may_id: 60,
      thanh_vien: [{ lsx_id: 1, lsx_ma: "LSX-1", lsx_step_key: "lsx-1-in", ghi_chu_ky_thuat: null }],
    })} canUpdate onLuu={async () => true} onTach={async () => {}} />);

    await user.click(screen.getByRole("button", { name: /Phân công & Thiết bị/ }));
    const may = await screen.findByLabelText(/MÁY CHẠY LƯỢT CHUNG/) as HTMLSelectElement;
    await screen.findByRole("option", { name: "Máy B" });
    expect([...may.options].map((o) => o.text)).toEqual(["— chọn máy —", "Máy B", "Máy D", "Máy A"]);

    await user.selectOptions(screen.getByLabelText(/TỔ PHỤ TRÁCH/), "5");
    expect(may.value).toBe("58");
    expect([...may.options].map((o) => o.text)).toEqual(["— chọn máy —", "Máy B", "Máy A"]);
  });

  it("công đoạn chưa khai tổ thì mời mọi tổ, không có câu giới hạn", async () => {
    render(<BuocChungForm g={gop({
      step_key: "gang-in-2",
      ten: "In chung",
      to_chon_duoc: [],
      thanh_vien: [{ lsx_id: 1, lsx_ma: "LSX-1", lsx_step_key: "lsx-1-in", ghi_chu_ky_thuat: null }],
    })} canUpdate onLuu={async () => true} onTach={async () => {}} />);

    await userEvent.setup().click(screen.getByRole("button", { name: /Phân công & Thiết bị/ }));
    const sel = await screen.findByLabelText(/TỔ PHỤ TRÁCH/);
    expect([...(sel as HTMLSelectElement).options].map((o) => o.text)).toEqual([
      "— chọn tổ —", "Tổ in", "Tổ cán phủ", "Tổ bế", "Tổ dán",
    ]);
    expect(screen.queryByText(/Chỉ các tổ phụ trách khai ở danh mục Công đoạn/)).toBeNull();
  });
});
