// Khối "Vật liệu đầu vào" đầu tab Công đoạn (12/11/2026): máy chủ chấm điểm các khổ trong kho, chọn sẵn
// phương án đầu; người kế hoạch mở hộp 8 phương án để đổi, về phương án tốt nhất, sửa lề sóng.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PhuongAnLay, VatLieuDauVao } from "../api/client";

const xem = vi.fn();
const doi = vi.fn();

vi.mock("../api/client", async (goc) => ({
  ...(await goc<typeof import("../api/client")>()),
  api: { lsx: { vatLieuDauVao: (...a: unknown[]) => xem(...a), doiVatLieu: (...a: unknown[]) => doi(...a) } },
}));

import { KhoiVatLieu } from "./KhoiVatLieu";

const pa = (o: Partial<PhuongAnLay>): PhuongAnLay => ({
  dang: "to", rong: 720, dai: 1020, so_manh: 1, buoc: [], can: 1560, don_vi: "to", ton: 0, diem: 50, ...o,
});
const TE = pa({ rong: 760, dai: 1060, buoc: ["Tề giấy in"], ton: 1800, diem: 86 });
const DUNG = pa({ ton: 800, diem: 76 });
const CUON = pa({ dang: "cuon", rong: 750, dai: 0, buoc: ["Cắt giấy cuộn", "Tề giấy in"], can: 358, don_vi: "kg", ton: 3200, diem: 78 });

function du(o: Partial<VatLieuDauVao> = {}): VatLieuDauVao {
  return {
    khoa: null,
    giay: {
      ten_hang: "Ivory 300", kho_can: [720, 1020], so_to_can: 1560, vao_buoc: "In offset", tru_le_mm: null,
      dang_lay: TE, ds: [TE, CUON, DUNG], tot_nhat: true, tu_khai: false,
    },
    song: {
      ten_hang: "Sóng E", kho_can: [715, 1015], so_to_can: 1500, vao_buoc: "Bồi carton", tru_le_mm: 5,
      dang_lay: pa({ rong: 715, dai: 1015, can: 1500, ton: 1800, diem: 100 }),
      ds: [pa({ rong: 715, dai: 1015, can: 1500, ton: 1800, diem: 100 })], tot_nhat: true, tu_khai: false,
    },
    ...o,
  };
}

const ve = (o?: Partial<VatLieuDauVao>, khoaNgoai: string | null = null) => {
  xem.mockResolvedValue(du(o));
  const onDoi = vi.fn();
  render(<KhoiVatLieu lsxId={7} token="t" khoaNgoai={khoaNgoai} phienBan={1} onDoi={onDoi} />);
  return onDoi;
};

beforeEach(() => { xem.mockReset(); doi.mockReset(); });

describe("KhoiVatLieu", () => {
  it("bảng năm cột, dòng giấy ghi khổ đang lấy, bước chuẩn bị và tồn / cần; không có chữ Máy chọn", async () => {
    ve();
    const nut = await screen.findByRole("button", { name: "Khổ giấy in lấy ở kho" });
    expect(nut.textContent).toBe("Tờ 760 × 1.060");
    for (const c of ["Vật liệu", "Lấy ở kho", "Chuẩn bị", "Vào bước", "Tồn / cần"]) {
      expect(screen.getByRole("columnheader", { name: c })).toBeTruthy();
    }
    expect(screen.getByText("Tề giấy in")).toBeTruthy();
    expect(screen.getByText("1.800 / 1.560 tờ")).toBeTruthy();
    expect(screen.getByText("Không cần, đúng khổ")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Máy chọn/);
  });

  it("mở hộp phương án có điểm, dòng đang lấy được chọn, chọn dòng khác gửi đúng khổ", async () => {
    doi.mockResolvedValue({ id: 7 });
    const onDoi = ve();
    fireEvent.click(await screen.findByRole("button", { name: "Khổ giấy in lấy ở kho" }));
    const dong = screen.getAllByRole("option");
    expect(dong).toHaveLength(3);
    expect(dong[0].getAttribute("aria-selected")).toBe("true");
    expect(dong[2].textContent).toMatch(/thiếu 760/);
    expect(screen.getByText(/Điểm 100: đủ tồn 50/)).toBeTruthy();
    fireEvent.click(dong[1]);
    await waitFor(() => expect(doi).toHaveBeenCalledWith("t", 7, { vat_lieu: "giay", rong: 750, dai: 0 }));
    await waitFor(() => expect(onDoi).toHaveBeenCalledWith({ id: 7 }));
  });

  it("chưa ở phương án tốt nhất thì có nút Về phương án tốt nhất", async () => {
    doi.mockResolvedValue({ id: 7 });
    ve({ giay: { ...du().giay!, dang_lay: DUNG, tot_nhat: false } });
    expect((await screen.findByRole("button", { name: "Khổ giấy in lấy ở kho" })).textContent).toBe("Tờ 720 × 1.020");
    expect(screen.getByText("thiếu 760")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Về phương án tốt nhất" }));
    await waitFor(() => expect(doi).toHaveBeenCalledWith("t", 7, { vat_lieu: "giay", ve_tot_nhat: true }));
  });

  it("sửa lề sóng gửi khi rời ô", async () => {
    doi.mockResolvedValue({ id: 7 });
    ve();
    const o = await screen.findByLabelText("Lề trừ mỗi chiều (mm)");
    fireEvent.change(o, { target: { value: "3" } });
    fireEvent.blur(o);
    await waitFor(() => expect(doi).toHaveBeenCalledWith("t", 7, { vat_lieu: "song", tru_le_mm: 3 }));
  });

  it("có câu khoá thì nút chọn tắt và câu khoá hiện dưới bảng", async () => {
    ve({ khoa: "Lệnh đang giữ chỗ vật tư" });
    const nut = await screen.findByRole("button", { name: "Khổ giấy in lấy ở kho" });
    expect((nut as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Lệnh đang giữ chỗ vật tư")).toBeTruthy();
  });

  it("lệnh tự khai bước chuẩn bị thì không có nút chọn", async () => {
    ve({ giay: { ...du().giay!, tu_khai: true }, song: null });
    expect(await screen.findByText("Lệnh tự khai bước chuẩn bị, không đổi ở đây")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Khổ giấy in lấy ở kho" })).toBeNull();
  });
});
