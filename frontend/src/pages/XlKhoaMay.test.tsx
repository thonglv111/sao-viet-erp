import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { XlKhoaMay } from "./XlKhoaMay";

// Lỗi #50 bấm thử 18/10/2026: không còn lối nào trên giao diện khai vùng khoá máy.
vi.mock("../auth/useAuth", () => ({ useAuth: () => ({ token: "token-test" }) }));
const mayGon = vi.fn();
const vungKhoa = vi.fn();
const taoVungKhoa = vi.fn();
const xoaVungKhoa = vi.fn();
vi.mock("../api/client", async (goc) => ({
  ...(await goc<typeof import("../api/client")>()),
  api: {
    xepLich: {
      mayGon: (...a: unknown[]) => mayGon(...a),
      vungKhoa: (...a: unknown[]) => vungKhoa(...a),
      taoVungKhoa: (...a: unknown[]) => taoVungKhoa(...a),
      xoaVungKhoa: (...a: unknown[]) => xoaVungKhoa(...a),
    },
  },
}));

const KHOA = { id: 9, may_id: 4, start: "2026-10-20T07:00:00", finish: "2026-10-20T12:00:00",
  ly_do: "bao_tri", note: "Thay lô", kieu: "chan" };

describe("XlKhoaMay", () => {
  beforeEach(() => {
    [mayGon, vungKhoa, taoVungKhoa, xoaVungKhoa].forEach((f) => f.mockReset());
    mayGon.mockResolvedValue([{ id: 4, ma: "MAY-01", ten: "Máy in 4 màu" }]);
    vungKhoa.mockResolvedValue([KHOA]);
  });

  it("chọn máy thì hiện các khoảng khoá đã khai, bấm Xoá hỏi lại rồi mới gỡ", async () => {
    const onDoi = vi.fn();
    render(<XlKhoaMay open suaDuoc onDong={vi.fn()} onDoi={onDoi} />);
    fireEvent.change(await screen.findByLabelText("Máy"), { target: { value: "4" } });
    expect(await screen.findByText("Thay lô")).toBeTruthy();
    expect(screen.getByRole("cell", { name: "Bảo trì" })).toBeTruthy();
    xoaVungKhoa.mockResolvedValue({ ok: true });
    vungKhoa.mockResolvedValue([]);
    fireEvent.click(screen.getByRole("button", { name: "Xoá khoảng khoá 20/10 07:00" }));
    expect(await screen.findByText("Xoá khoảng khoá?")).toBeTruthy();
    expect(xoaVungKhoa).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Xoá" }));
    await waitFor(() => expect(xoaVungKhoa).toHaveBeenCalledWith("token-test", 9));
    expect(await screen.findByText("Máy này chưa có khoảng khoá nào.")).toBeTruthy();
    expect(onDoi).toHaveBeenCalled();
  });

  it("thêm khoảng khoá gửi máy, giờ và lý do đã chọn", async () => {
    vungKhoa.mockResolvedValue([]);
    render(<XlKhoaMay open suaDuoc onDong={vi.fn()} onDoi={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText("Máy"), { target: { value: "4" } });
    await screen.findByText("Máy này chưa có khoảng khoá nào.");
    fireEvent.change(screen.getByLabelText("Lý do"), { target: { value: "hong_hoc" } });
    fireEvent.change(screen.getByLabelText("Ghi chú"), { target: { value: "Gãy trục lô" } });
    taoVungKhoa.mockResolvedValue({ ...KHOA, ly_do: "hong_hoc", note: "Gãy trục lô" });
    fireEvent.click(screen.getByRole("button", { name: "Thêm khoảng khoá" }));
    await waitFor(() => expect(taoVungKhoa).toHaveBeenCalled());
    const [tok, may, body] = taoVungKhoa.mock.calls[0];
    expect([tok, may, body.ly_do, body.note]).toEqual(["token-test", 4, "hong_hoc", "Gãy trục lô"]);
    expect(body.tu < body.den).toBe(true);
  });

  it("chỉ có quyền xem thì không có nút ghi", async () => {
    render(<XlKhoaMay open suaDuoc={false} onDong={vi.fn()} onDoi={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText("Máy"), { target: { value: "4" } });
    await screen.findByText("Thay lô");
    expect(screen.queryByRole("button", { name: /Xoá khoảng khoá/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Thêm khoảng khoá" })).toBeNull();
  });

  it("Esc khi đang hỏi xoá chỉ đóng hộp hỏi, hộp Khoá máy vẫn mở", async () => {
    const onDong = vi.fn();
    render(<XlKhoaMay open suaDuoc onDong={onDong} onDoi={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText("Máy"), { target: { value: "4" } });
    fireEvent.click(await screen.findByRole("button", { name: "Xoá khoảng khoá 20/10 07:00" }));
    await screen.findByText("Xoá khoảng khoá?");
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByText("Xoá khoảng khoá?")).toBeNull());
    expect(onDong).not.toHaveBeenCalled();
  });

  it("tải khoảng khoá lỗi thì thôi Đang tải, hiện câu lỗi", async () => {
    vungKhoa.mockRejectedValue(new Error("Mất kết nối"));
    render(<XlKhoaMay open suaDuoc onDong={vi.fn()} onDoi={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText("Máy"), { target: { value: "4" } });
    expect(await screen.findByText("Mất kết nối")).toBeTruthy();
    expect(screen.queryByText("Đang tải…")).toBeNull();
  });

  it("khoảng chạy thêm ngoài ca ghi Chạy thêm, không ghi Khác", async () => {
    vungKhoa.mockResolvedValue([{ ...KHOA, ly_do: "khac", kieu: "mo_them" }]);
    render(<XlKhoaMay open suaDuoc={false} onDong={vi.fn()} onDoi={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText("Máy"), { target: { value: "4" } });
    expect(await screen.findByRole("cell", { name: "Chạy thêm" })).toBeTruthy();
  });
});
