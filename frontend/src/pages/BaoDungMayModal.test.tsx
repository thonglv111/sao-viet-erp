// Hộp Báo dừng máy ở bàn tổ (Đợt 2 công thức khoán, 21/10/2026; gộp Báo sự cố 23/10/2026).
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { SxDungMayListOut } from "../api/client";
import { BaoDungMayModal, type DungMayExec } from "./BaoDungMayModal";

const DS: SxDungMayListOut = {
  ky_da_chot: [],
  ds: [{
    id: 4, department_id: 7, ngay: "2026-10-15", ly_do: "may_hu", ly_do_ten: "Máy hư",
    sua_chua_id: 7, sua_chua_ma: "SC-0014", ghi_chu: null,
    nguoi: [{ employee_id: 1, ho_ten: "An" }],
  }],
  nguoi: [{ employee_id: 1, ho_ten: "An" }, { employee_id: 2, ho_ten: "Bình" }],
  phieu_sua: [{ id: 7, ma: "SC-0014", may_ten: "Máy 4 màu", bo_phan_hong: null }],
  may: [
    { id: 2, ma: "IN-02", ten: "Máy in 4 màu", viec: "LSX26-0003 Bài in", viec_dang_chay: true, dang_mo: null },
    { id: 1, ma: "IN-01", ten: "Máy in 2 màu", viec: null, viec_dang_chay: false, dang_mo: "YC-0009" },
  ],
  hom_nay: "2026-10-21",
  quyen_bao_hong: true,
  quyen_luong: true,
};
/** Ngày xưởng đã sang 22/10 mà hộp mở ở 21/10 ⇒ Máy hư là báo bù ngày đã qua, chỉ còn phần lương. */
const DS_NGAY_QUA: SxDungMayListOut = { ...DS, hom_nay: "2026-10-22" };

function mo(ds: SxDungMayListOut = DS) {
  const exec: DungMayExec = {
    ds: vi.fn().mockResolvedValue(ds),
    bao: vi.fn().mockResolvedValue(DS.ds[0]),
    xoa: vi.fn().mockResolvedValue(undefined),
    sua: vi.fn().mockResolvedValue(DS.ds[0]),
    mayHu: vi.fn().mockResolvedValue({
      yeu_cau_ma: "YC-0010", phieu_ma: null, moi: true, tam_dung: [55], dung_may: null,
    }),
  };
  const onBao = vi.fn();
  const onDong = vi.fn();
  render(<BaoDungMayModal tenTo="Tổ in 4 màu" homNay="2026-10-21" exec={exec} onDong={onDong} onBao={onBao} />);
  return { exec, onBao, onDong };
}

describe("Báo dừng máy", () => {
  it("Hết hàng, bỏ tick một người, Lưu ⇒ gửi đúng người còn lại", async () => {
    const user = userEvent.setup();
    const { exec, onBao } = mo();
    await screen.findByLabelText("Bình");
    expect(exec.ds).toHaveBeenCalledWith(2026, 10);
    await user.click(screen.getByRole("button", { name: "Hết hàng" }));
    await user.click(screen.getByLabelText("Bình"));
    await user.click(screen.getByRole("button", { name: "Lưu" }));
    expect(exec.bao).toHaveBeenCalledTimes(1);
    expect(exec.bao).toHaveBeenCalledWith({
      ngay: "2026-10-21", ly_do: "het_hang", sua_chua_id: null, ghi_chu: null, nguoi_ids: [1],
    });
    expect(onBao).toHaveBeenCalledWith("Đã báo dừng máy ngày 21/10.");
    expect(exec.ds).toHaveBeenCalledTimes(2);
  });

  it("Máy hư ngày đã qua: chỉ còn phần lương, có ô Phiếu sửa máy", async () => {
    const user = userEvent.setup();
    mo(DS_NGAY_QUA);
    await screen.findByLabelText("Bình");
    expect(screen.queryByLabelText("Phiếu sửa máy")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Máy hư" }));
    await user.selectOptions(screen.getByLabelText("Phiếu sửa máy"), "7");
    await user.click(screen.getByRole("button", { name: "Hết hàng" }));
    expect(screen.queryByLabelText("Phiếu sửa máy")).toBeNull();
  });

  it("chưa chọn lý do thì chưa Lưu được", async () => {
    mo();
    await screen.findByLabelText("Bình");
    expect(screen.getByRole("button", { name: "Lưu" })).toBeDisabled();
  });

  it("ngày đã báo trong tháng có nút xoá; máy chủ trả lỗi thì hiện câu lỗi", async () => {
    const user = userEvent.setup();
    const { exec } = mo();
    expect(await screen.findByText("15/10")).toBeInTheDocument();
    expect(screen.getByText("SC-0014")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Xoá ngày 15/10" }));
    // Xoá ngày dừng là đổi lương cả tổ ⇒ hỏi lại ngay trên dòng, Thôi thì không xoá.
    expect(screen.getByText("Xoá hẳn ngày 15/10?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Thôi" }));
    expect(exec.xoa).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Xoá ngày 15/10" }));
    await user.click(screen.getByRole("button", { name: "Xoá" }));
    expect(exec.xoa).toHaveBeenCalledWith(4);

    (exec.bao as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("Tổ đã báo dừng máy ngày 21/10."));
    await user.click(screen.getByRole("button", { name: "Hết hàng" }));
    await user.click(screen.getByRole("button", { name: "Lưu" }));
    expect(await screen.findByText("Tổ đã báo dừng máy ngày 21/10.")).toBeInTheDocument();
  });

  it("Sửa ngày đã báo: mở sẵn giá trị cũ, đổi người hưởng, Lưu gọi sửa không đổi ngày", async () => {
    const user = userEvent.setup();
    const { exec, onBao } = mo();
    await user.click(await screen.findByRole("button", { name: "Sửa ngày 15/10" }));
    expect(screen.getByRole("button", { name: "Máy hư" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Phiếu sửa máy")).toHaveValue("7");
    expect(screen.getByLabelText("An")).toBeChecked();
    expect(screen.getByLabelText("Bình")).not.toBeChecked();
    expect(screen.queryByLabelText("Ngày dừng máy")).toBeNull();
    await user.click(screen.getByLabelText("Bình"));
    await user.click(screen.getByRole("button", { name: "Lưu" }));
    expect(exec.sua).toHaveBeenCalledWith(4, {
      ly_do: "may_hu", sua_chua_id: 7, ghi_chu: null, nguoi_ids: [1, 2],
    });
    expect(exec.bao).not.toHaveBeenCalled();
    expect(onBao).toHaveBeenCalledWith("Đã sửa ngày dừng máy 15/10.");
  });

  it("kỳ lương tháng đã chốt: dòng đã báo không còn Sửa / Xoá, ngày thuộc kỳ không Lưu được", async () => {
    const user = userEvent.setup();
    mo({ ...DS, ky_da_chot: ["2026-09", "2026-10"] });
    expect(await screen.findByText("15/10")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sửa ngày 15/10" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Xoá ngày 15/10" })).toBeNull();
    expect(screen.getAllByText(/Kỳ lương tháng 10\/2026 đã chốt/).length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "Hết hàng" }));
    expect(screen.getByRole("button", { name: "Lưu" })).toBeDisabled();
  });

  it("Máy hư hôm nay: máy đang chạy chọn sẵn, gửi tổ sửa chữa không kèm lương", async () => {
    const user = userEvent.setup();
    const { exec, onBao, onDong } = mo();
    await screen.findByLabelText("Bình");
    await user.click(screen.getByRole("button", { name: "Máy hư" }));
    expect(screen.getByLabelText("IN-02 Máy in 4 màu")).toBeChecked();
    expect(screen.getByText("Đang chạy LSX26-0003 Bài in")).toBeInTheDocument();
    expect(screen.getByText("Đã báo YC-0009, gửi nữa sẽ gắn vào đây")).toBeInTheDocument();
    expect(screen.queryByLabelText("Phiếu sửa máy")).toBeNull();
    // Chưa tick lương thì không hỏi người hưởng.
    expect(screen.queryByLabelText("Bình")).toBeNull();
    await user.click(screen.getByLabelText(/Máy đang dừng/));
    expect(screen.getByText("Ưu tiên cao và tạm dừng việc")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Nghiêm trọng/ }));
    await user.type(screen.getByLabelText("Triệu chứng"), "Kêu to");
    await user.click(screen.getByRole("button", { name: "Gửi tổ sửa chữa" }));
    expect(exec.mayHu).toHaveBeenCalledWith({
      may_id: 2, muc_do: "nghiem_trong", mo_ta: "Kêu to", dung_san_xuat: true,
      tinh_luong: false, ghi_chu: null, nguoi_ids: [],
    });
    expect(exec.bao).not.toHaveBeenCalled();
    expect(onBao).toHaveBeenCalledWith("Đã gửi YC-0010 tới tổ sửa chữa, việc trên máy đã tạm dừng.");
    expect(onDong).toHaveBeenCalled();
  });

  it("Máy hư hôm nay tick Tính ngày dừng cho lương: hỏi người hưởng, gửi cả hai trong một lần", async () => {
    const user = userEvent.setup();
    const { exec } = mo();
    await screen.findByText("15/10");
    await user.click(screen.getByRole("button", { name: "Máy hư" }));
    await user.click(screen.getByLabelText("IN-01 Máy in 2 màu"));
    await user.click(screen.getByLabelText(/Tính ngày dừng cho lương/));
    await user.click(screen.getByLabelText("Bình"));
    await user.click(screen.getByRole("button", { name: "Gửi tổ sửa chữa và lưu ngày dừng" }));
    expect(exec.mayHu).toHaveBeenCalledWith({
      may_id: 1, muc_do: "trung_binh", mo_ta: null, dung_san_xuat: false,
      tinh_luong: true, ghi_chu: null, nguoi_ids: [1],
    });
  });

  it("tổ đã có ngày dừng hôm nay: ô tính lương khoá, vẫn gửi tổ sửa chữa được", async () => {
    const user = userEvent.setup();
    mo({ ...DS, ds: [{ ...DS.ds[0], id: 5, ngay: "2026-10-21" }] });
    await screen.findByText("21/10");
    await user.click(screen.getByRole("button", { name: "Máy hư" }));
    expect(screen.getByLabelText(/Tính ngày dừng cho lương/)).toBeDisabled();
    expect(screen.getByText("Tổ đã báo dừng máy ngày 21/10, sửa ở bảng dưới nếu cần.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Gửi tổ sửa chữa" })).toBeEnabled();
  });

  it("tổ chưa có máy: nói cách khai, chưa gửi được", async () => {
    const user = userEvent.setup();
    mo({ ...DS, may: [] });
    await screen.findByLabelText("Bình");
    await user.click(screen.getByRole("button", { name: "Máy hư" }));
    expect(screen.getByText(/Tổ chưa có máy nào/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Gửi tổ sửa chữa" })).toBeDisabled();
  });

  it("chỉ có ô Báo hỏng: hộp chỉ còn máy hư hôm nay, không ngày, lý do, lương, bảng đã báo", async () => {
    const user = userEvent.setup();
    const { exec, onBao } = mo({
      ky_da_chot: [], ds: [], nguoi: [], phieu_sua: [], may: DS.may, hom_nay: "2026-10-21",
      quyen_bao_hong: true, quyen_luong: false,
    });
    await screen.findByLabelText("IN-02 Máy in 4 màu");
    expect(screen.queryByLabelText("Ngày dừng máy")).toBeNull();
    expect(screen.queryByRole("button", { name: "Hết hàng" })).toBeNull();
    expect(screen.queryByLabelText(/Tính ngày dừng cho lương/)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Gửi tổ sửa chữa" }));
    expect(exec.mayHu).toHaveBeenCalledWith(expect.objectContaining({ may_id: 2, tinh_luong: false, nguoi_ids: [] }));
    expect(onBao).toHaveBeenCalled();
  });

  it("có lương mà không có ô Báo hỏng: máy hư hôm nay chỉ lưu ngày dừng, không gửi tổ sửa chữa", async () => {
    const user = userEvent.setup();
    const { exec } = mo({ ...DS, quyen_bao_hong: false });
    await screen.findByLabelText("Bình");
    await user.click(screen.getByRole("button", { name: "Máy hư" }));
    expect(screen.queryByRole("radiogroup", { name: "Máy hư" })).toBeNull();
    expect(screen.getByLabelText("Phiếu sửa máy")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Lưu" }));
    expect(exec.bao).toHaveBeenCalledTimes(1);
    expect(exec.mayHu).not.toHaveBeenCalled();
  });
});
